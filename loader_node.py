import os
import itertools
import re
import json
import folder_paths
import comfy.sd
import comfy.utils

# 定義基礎路徑常數
NODE_FILE_PATH = os.path.dirname(os.path.abspath(__file__))
TAGS_DIR = os.path.join(NODE_FILE_PATH, "tags")

class DynamicTagLoaderJS:
    """
    ComfyUI 自定義節點：動態 Tag 載入器
    功能：根據前端傳入的 JSON 設定，動態讀取資料夾內的 Prompt 檔案，
    並支援 LoRA 的自動解析與載入。
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

    # 定義輸出類型與名稱
    RETURN_TYPES = ("MODEL", "CLIP", "CONDITIONING", "STRING", "INT")
    RETURN_NAMES = ("model", "clip", "positive", "prompt", "count")
    OUTPUT_IS_LIST = (True, True, True, True, False) # 注意: count 為單一數值，非列表
    
    FUNCTION = "process"
    CATEGORY = "Custom/TagLoader"

    @classmethod
    def IS_CHANGED(s, **kwargs):
        # 設定為 NaN 以確保每次執行時都會重新計算 (避免快取導致不更新)
        return float("nan")

    def _parse_and_strip_lora(self, text):
        """解析並分離文本中的 <lora:...> 語法，回傳純淨文本與 LoRA 設定列表"""
        if not text:
            return "", []
        lora_pattern = r"<lora:([^>:]+)(?::([0-9.]+))?>"
        found_loras = []
        for match in re.finditer(lora_pattern, text):
            lora_name = match.group(1)
            strength = float(match.group(2)) if match.group(2) else 1.0
            found_loras.append((lora_name, strength))
        
        # 清除 LoRA 標籤並規範化換行符號
        cleaned_text = re.sub(lora_pattern, "", text)
        cleaned_text = re.sub(r'\n\s*\n', '\n', cleaned_text)
        cleaned_text = cleaned_text.strip()
        return cleaned_text, found_loras

    def _load_lora(self, model, clip, lora_name, strength_model, strength_clip):
        """動態載入指定的 LoRA 模型並應用於 Model 與 CLIP"""
        if model is None or clip is None:
            return model, clip
            
        # 嘗試搜尋 LoRA 檔案路徑
        lora_path = folder_paths.get_full_path("loras", lora_name)
        if lora_path is None:
            lora_path = folder_paths.get_full_path("loras", f"{lora_name}.safetensors")
            
        # 若完全匹配失敗，嘗試模糊搜尋 (忽略副檔名大小寫)
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
            lora_model = comfy.utils.load_torch_file(lora_path, safe_load=True)
            model_lora, clip_lora = comfy.sd.load_lora_for_models(model, clip, lora_model, strength_model, strength_clip)
            return model_lora, clip_lora
        except Exception as e:
            print(f"[DynamicTagLoader] Error loading lora {lora_name}: {e}")
            return model, clip

    def _read_file(self, path):
        """安全讀取檔案內容"""
        try:
            with open(path, 'r', encoding='utf-8') as f:
                return f.read().strip()
        except:
            return None

    def process(self, text_input, tag_settings, model=None, clip=None, **kwargs):
        """
        核心處理函數
        1. 解析 tag_settings JSON 設定
        2. 讀取指定資料夾/檔案的 Prompt
        3. 組合 Prompt 並解析其中的 LoRA
        4. 生成最終的 Conditioning 與 Model 輸出
        """
        delimiter = "\n" 
        try:
            settings = json.loads(tag_settings)
        except Exception as e:
            settings = {}

        base_text_cleaned, base_loras = self._parse_and_strip_lora(text_input)
        prompts_groups = []
        
        # 依照前端 UI 順序排序 (key 為索引值)
        sorted_keys = sorted(settings.keys(), key=lambda x: int(x))
        
        for key in sorted_keys:
            item = settings[key]
            item_type = item.get("type", "file")

            if item_type == "text":
                # 處理純文字輸入
                raw_text = item.get("text", "")
                if raw_text:
                    cleaned_text, loras = self._parse_and_strip_lora(raw_text)
                    prompts_groups.append([(cleaned_text, loras)])
            else:
                # 處理檔案讀取
                folder_name = item.get("folder")
                file_name = item.get("file")
                if not folder_name or not file_name:
                    continue
                
                # 路徑解析：處理根目錄標識與相對路徑轉換 (相容多層級子目錄)
                if folder_name == "Root":
                    folder_path = TAGS_DIR
                else:
                    folder_path = os.path.join(TAGS_DIR, os.path.normpath(folder_name))
                
                current_group_data = [] 
                files_to_read = []
                
                # 檔案選取策略
                if file_name == "ALL":
                    if os.path.exists(folder_path):
                        # 僅列出當前目錄下的 .txt 檔案 (不包含子目錄內容，符合邏輯設計)
                        files_to_read = sorted([f for f in os.listdir(folder_path) if f.endswith(".txt")])
                else:
                    files_to_read = [file_name]

                # 讀取檔案內容
                for f_name in files_to_read:
                    raw_content = self._read_file(os.path.join(folder_path, f_name))
                    if raw_content is not None:
                        cleaned_text, loras = self._parse_and_strip_lora(raw_content)
                        current_group_data.append((cleaned_text, loras))
                
                if current_group_data:
                    prompts_groups.append(current_group_data)

        # 產生所有組合 (笛卡兒積)
        if not prompts_groups:
            combinations = [([],)] if base_text_cleaned or base_loras else []
        else:
            combinations = list(itertools.product(*prompts_groups))
        
        final_models = []
        final_clips = []
        final_prompts = []
        final_conditionings = []

        # 遍歷組合並構建輸出
        for combo in combinations:
            current_texts = []
            if base_text_cleaned:
                current_texts.append(base_text_cleaned)
            current_texts.extend([item[0] for item in combo if item and item[0]])
            combined_prompt = delimiter.join(current_texts)
            
            # 合併全域與局部 LoRA
            all_loras = []
            if base_loras:
                all_loras.extend(base_loras)
            for item in combo:
                if item:
                    all_loras.extend(item[1]) 
            
            # 應用 LoRA 至 Model 與 CLIP
            current_model = model
            current_clip = clip
            if current_model is not None and current_clip is not None and all_loras:
                for lora_name, strength in all_loras:
                    current_model, current_clip = self._load_lora(current_model, current_clip, lora_name, strength, strength)
            
            # CLIP Tokenize 與 Encode
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
        print(f"JS Loader: Generated {count} combinations.")
        
        if not final_prompts:
            return ([], [], [], [], 0)
        
        return (final_models, final_clips, final_conditionings, final_prompts, count)