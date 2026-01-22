import os
import itertools
import re
import json
import folder_paths
import comfy.sd
import comfy.utils

# -----------------------------------------------------------
# 基礎路徑配置
# -----------------------------------------------------------
NODE_FILE_PATH = os.path.dirname(os.path.abspath(__file__))
TAGS_DIR = os.path.join(NODE_FILE_PATH, "tags")

class DynamicTagLoaderJS:
    """
    ComfyUI 自定義節點：動態標籤加載器 (Dynamic Tag Loader)
    核心功能：
    1. 解析前端傳入的 JSON 配置，讀取對應的標籤檔案。
    2. 自動提取文本中的 LoRA 語法並應用於模型與 CLIP。
    3. 針對多個標籤群組生成「笛卡兒積 (Cartesian Product)」組合，實現批次生成。
    """

    @classmethod
    def INPUT_TYPES(s):
        return {
            "required": {
                "text_input": ("STRING", {"default": "", "multiline": True, "placeholder": "Global Prompt (Prepend to all)..."}),
                "tag_settings": ("STRING", {"default": "{}", "multiline": False}),
            },
            "optional": {
                "model": ("MODEL",),
                "clip": ("CLIP",),
            }
        }

    # 輸出定義：模型、CLIP、Conditioning、原始 Prompt、生成的組合總數
    RETURN_TYPES = ("MODEL", "CLIP", "CONDITIONING", "STRING", "INT")
    RETURN_NAMES = ("model", "clip", "positive", "prompt", "count")
    # 標示輸出為列表形式，以便於 Batch 處理
    OUTPUT_IS_LIST = (True, True, True, True, False) 
    
    FUNCTION = "process"
    CATEGORY = "Custom/TagLoader"

    @classmethod
    def IS_CHANGED(s, **kwargs):
        """強迫 ComfyUI 忽略快取機制，確保每次執行皆重新解析檔案內容"""
        return float("nan")

    def _parse_and_strip_lora(self, text):
        """
        Regex 解析器：提取文本中的 <lora:name:weight> 標籤。
        
        Args:
            text (str): 原始 Prompt 文本
        Returns:
            tuple: (清理後的文本, LoRA 配置列表 [(name, weight), ...])
        """
        if not text:
            return "", []
        lora_pattern = r"<lora:([^>:]+)(?::([0-9.]+))?>"
        found_loras = []
        for match in re.finditer(lora_pattern, text):
            lora_name = match.group(1)
            strength = float(match.group(2)) if match.group(2) else 1.0
            found_loras.append((lora_name, strength))
        
        # 移除 LoRA 語法並規範化空白與換行符號
        cleaned_text = re.sub(lora_pattern, "", text)
        cleaned_text = re.sub(r'\n\s*\n', '\n', cleaned_text)
        cleaned_text = cleaned_text.strip()
        return cleaned_text, found_loras

    def _load_lora(self, model, clip, lora_name, strength_model, strength_clip):
        """
        動態 LoRA 加載邏輯：包含檔案路徑檢索與模糊匹配。
        
        Args:
            model: 模型實例
            clip: CLIP 實例
            lora_name: LoRA 檔案名稱
            strength_model: 模型強度
            strength_clip: CLIP 強度
        """
        if model is None or clip is None:
            return model, clip
            
        # 優先執行完整路徑匹配
        lora_path = folder_paths.get_full_path("loras", lora_name)
        if lora_path is None:
            lora_path = folder_paths.get_full_path("loras", f"{lora_name}.safetensors")
            
        # 備選方案：執行不區分大小寫的模糊搜索 (忽略副檔名)
        if lora_path is None:
            available_loras = folder_paths.get_filename_list("loras")
            target_name = lora_name.lower()
            if target_name.endswith(".safetensors"):
                target_name = target_name[:-12]
            for candidate in available_loras:
                candidate_name = os.path.splitext(os.path.basename(candidate))[0].lower()
                if candidate_name == target_name:
                    lora_path = folder_paths.get_full_path("loras", candidate)
                    break
                    
        if lora_path is None:
            print(f"[DynamicTagLoader] Warning: Lora not found: {lora_name}")
            return model, clip
            
        try:
            # 調用 ComfyUI 核心函數加載 LoRA 權重並應用至 Patch 隊列
            lora_model = comfy.utils.load_torch_file(lora_path, safe_load=True)
            model_lora, clip_lora = comfy.sd.load_lora_for_models(model, clip, lora_model, strength_model, strength_clip)
            return model_lora, clip_lora
        except Exception as e:
            print(f"[DynamicTagLoader] Error loading lora {lora_name}: {e}")
            return model, clip

    def _read_file(self, path):
        """IO 輔助函數：執行安全讀取並過濾結尾空白"""
        try:
            with open(path, 'r', encoding='utf-8') as f:
                return f.read().strip()
        except:
            return None

    def process(self, text_input, tag_settings, model=None, clip=None, **kwargs):
        """
        主要處理工作流：
        1. 解析 tag_settings JSON 設定，按索引排序。
        2. 遍歷檔案系統獲取 Prompt 片段，並分離文本與 LoRA 設定。
        3. 利用 itertools.product 計算所有可能的 Prompt 組合 (笛卡兒積)。
        4. 為每組組合進行模型加權 (LoRA) 與文本編碼 (Conditioning)。
        """
        delimiter = "\n" 
        try:
            settings = json.loads(tag_settings)
        except Exception as e:
            settings = {}

        # 預處理全域輸入 (Global Prompt)
        base_text_cleaned, base_loras = self._parse_and_strip_lora(text_input)
        prompts_groups = []
        
        # 根據前端 UI 設定的索引順序進行數據構造
        sorted_keys = sorted(settings.keys(), key=lambda x: int(x))
        
        for key in sorted_keys:
            item = settings[key]
            item_type = item.get("type", "file")

            if item_type == "text":
                # 處理純文本組件
                raw_text = item.get("text", "")
                if raw_text:
                    cleaned_text, loras = self._parse_and_strip_lora(raw_text)
                    prompts_groups.append([(cleaned_text, loras)])
            else:
                # 處理標籤檔案組件
                folder_name = item.get("folder")
                file_name = item.get("file")
                if not folder_name or not file_name:
                    continue
                
                # 路徑安全化處理
                if folder_name == "Root":
                    folder_path = TAGS_DIR
                else:
                    folder_path = os.path.join(TAGS_DIR, os.path.normpath(folder_name))
                
                current_group_data = [] 
                files_to_read = []
                
                # 檔案檢索策略：若選擇 "ALL" 則枚舉目錄下所有 .txt 檔案
                if file_name == "ALL":
                    if os.path.exists(folder_path):
                        files_to_read = sorted([f for f in os.listdir(folder_path) if f.endswith(".txt")])
                else:
                    files_to_read = [file_name]

                for f_name in files_to_read:
                    raw_content = self._read_file(os.path.join(folder_path, f_name))
                    if raw_content is not None:
                        cleaned_text, loras = self._parse_and_strip_lora(raw_content)
                        current_group_data.append((cleaned_text, loras))
                
                if current_group_data:
                    prompts_groups.append(current_group_data)

        # 核心運算：計算所有標籤組件的笛卡兒積組合
        if not prompts_groups:
            combinations = [([],)] if base_text_cleaned or base_loras else []
        else:
            combinations = list(itertools.product(*prompts_groups))
        
        final_models = []
        final_clips = []
        final_prompts = []
        final_conditionings = []

        # 遍歷組合，構建最終輸出列表
        for combo in combinations:
            current_texts = []
            if base_text_cleaned:
                current_texts.append(base_text_cleaned)
            current_texts.extend([item[0] for item in combo if item and item[0]])
            combined_prompt = delimiter.join(current_texts)
            
            # 整合全域與局部 (檔案內) 的 LoRA 配置
            all_loras = []
            if base_loras:
                all_loras.extend(base_loras)
            for item in combo:
                if item:
                    all_loras.extend(item[1]) 
            
            # 執行 LoRA 疊加應用
            current_model = model
            current_clip = clip
            if current_model is not None and current_clip is not None and all_loras:
                for lora_name, strength in all_loras:
                    current_model, current_clip = self._load_lora(current_model, current_clip, lora_name, strength, strength)
            
            # 文本編碼處理：將組合成的 Prompt 轉換為 Conditioning 向量
            current_conditioning = None
            if current_clip is not None:
                try:
                    tokens = current_clip.tokenize(combined_prompt)
                    cond, pooled = current_clip.encode_from_tokens(tokens, return_pooled=True)
                    current_conditioning = [[cond, {"pooled_output": pooled}]]
                except:
                    pass

            final_models.append(current_model)
            final_clips.append(current_clip)
            final_prompts.append(combined_prompt)
            final_conditionings.append(current_conditioning)

        count = len(final_prompts)
        print(f"[DynamicTagLoader] Logic: Generated {count} batch combinations.")
        
        if not final_prompts:
            return ([], [], [], [], 0)
        
        # 回傳封裝後的組合列表
        return (final_models, final_clips, final_conditionings, final_prompts, count)