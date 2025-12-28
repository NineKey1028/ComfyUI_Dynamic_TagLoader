import os
import itertools
import re
import json
import folder_paths
import comfy.sd
import comfy.utils

# 初始化路徑配置
NODE_FILE_PATH = os.path.dirname(os.path.abspath(__file__))
TAGS_DIR = os.path.join(NODE_FILE_PATH, "tags")

class DynamicTagLoaderJS:
    @classmethod
    def INPUT_TYPES(s):
        return {
            "required": {
                # [新增] 全域 Prompt 輸入框，放在最前面
                "text_input": ("STRING", {"default": "", "multiline": True, "placeholder": "Global Prompt (Prepend to all)..."}),
                # 接收前端傳來的 JSON 設定字串
                "tag_settings": ("STRING", {"default": "{}", "multiline": False}),
            },
            "optional": {
                "model": ("MODEL",),
                "clip": ("CLIP",),
            }
        }

    # 定義輸出類型：支援 Batch List 輸出
    RETURN_TYPES = ("MODEL", "CLIP", "CONDITIONING", "STRING")
    RETURN_NAMES = ("model", "clip", "positive", "prompt")
    OUTPUT_IS_LIST = (True, True, True, True)
    
    FUNCTION = "process"
    CATEGORY = "Custom/TagLoader"

    # 強制每次執行都視為變更 (因為外部 txt 檔案內容可能隨時改變)
    @classmethod
    def IS_CHANGED(s, **kwargs):
        return float("nan")

    # ----------------------------------------------------------------
    # 核心邏輯 1: 解析文本中的 LoRA 語法 <lora:name:strength>
    # ----------------------------------------------------------------
    def _parse_and_strip_lora(self, text):
        if not text:
            return "", []

        # 定義正則表達式：捕捉 <lora:檔名> 或 <lora:檔名:權重>
        lora_pattern = r"<lora:([^>:]+)(?::([0-9.]+))?>"
        
        found_loras = []
        
        # 1. 提取所有 LoRA 資訊
        for match in re.finditer(lora_pattern, text):
            lora_name = match.group(1)
            # 若無指定權重，預設為 1.0
            strength = float(match.group(2)) if match.group(2) else 1.0
            found_loras.append((lora_name, strength))
            
        # 2. 從原始文本中移除 LoRA 標籤
        cleaned_text = re.sub(lora_pattern, "", text)
        
        # 3. 清理殘留的空白與多餘換行
        cleaned_text = re.sub(r'\n\s*\n', '\n', cleaned_text) # 將多個換行縮減為一個
        cleaned_text = cleaned_text.strip()
            
        return cleaned_text, found_loras

    # ----------------------------------------------------------------
    # 核心邏輯 2: 實際載入 LoRA 到模型 (含路徑模糊搜尋)
    # ----------------------------------------------------------------
    def _load_lora(self, model, clip, lora_name, strength_model, strength_clip):
        if model is None or clip is None:
            return model, clip
            
        # 嘗試 1: 直接取得完整路徑
        lora_path = folder_paths.get_full_path("loras", lora_name)
        
        # 嘗試 2: 自動補上 .safetensors 副檔名
        if lora_path is None:
            lora_path = folder_paths.get_full_path("loras", f"{lora_name}.safetensors")

        # 嘗試 3: 遍歷所有子資料夾尋找同名檔案 (模糊比對)
        if lora_path is None:
            available_loras = folder_paths.get_filename_list("loras")
            target_name = lora_name.lower()
            if target_name.endswith(".safetensors"):
                target_name = target_name[:-12]
            
            for candidate in available_loras:
                # 比對去除路徑與副檔名後的純檔名
                candidate_name = os.path.splitext(os.path.basename(candidate))[0].lower()
                if candidate_name == target_name:
                    lora_path = folder_paths.get_full_path("loras", candidate)
                    print(f"[DynamicTagLoader] Auto-resolved subfolder: {lora_name} -> {candidate}")
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
        try:
            with open(path, 'r', encoding='utf-8') as f:
                return f.read().strip()
        except:
            return None

    # ----------------------------------------------------------------
    # 主流程: 處理輸入 -> 排列組合 -> 應用 LoRA -> 輸出列表
    # ----------------------------------------------------------------
    def process(self, text_input, tag_settings, model=None, clip=None, **kwargs):
        delimiter = "\n" 

        # 1. 解析前端傳來的 JSON 設定
        try:
            settings = json.loads(tag_settings)
        except Exception as e:
            print(f"JSON Error: {e}")
            settings = {}

        # 1.5 [新增] 處理全域 Prompt 輸入框
        # 解析輸入框中的文字與 LoRA
        base_text_cleaned, base_loras = self._parse_and_strip_lora(text_input)

        prompts_groups = []
        # 依照 index 鍵值排序確保順序
        sorted_keys = sorted(settings.keys(), key=lambda x: int(x))
        
        # 2. 讀取每個設定區塊 (Text 或 File)
        for key in sorted_keys:
            item = settings[key]
            item_type = item.get("type", "file")

            if item_type == "text":
                # 處理直接輸入的文字
                raw_text = item.get("text", "")
                if raw_text:
                    cleaned_text, loras = self._parse_and_strip_lora(raw_text)
                    prompts_groups.append([(cleaned_text, loras)])
            else:
                # 處理檔案讀取 (單一檔案 或 資料夾內所有檔案)
                folder_name = item.get("folder")
                file_name = item.get("file")
                
                if not folder_name or not file_name:
                    continue
                    
                folder_path = os.path.join(TAGS_DIR, folder_name)
                current_group_data = [] 
                
                files_to_read = []
                if file_name == "ALL":
                    if os.path.exists(folder_path):
                        files_to_read = sorted([f for f in os.listdir(folder_path) if f.endswith(".txt")])
                else:
                    files_to_read = [file_name]

                for f_name in files_to_read:
                    raw_content = self._read_file(os.path.join(folder_path, f_name))
                    if raw_content:
                        cleaned_text, loras = self._parse_and_strip_lora(raw_content)
                        current_group_data.append((cleaned_text, loras))
                
                if current_group_data:
                    prompts_groups.append(current_group_data)

        # 3. 生成排列組合 (Cartesian Product)
        # 即使沒有選擇任何檔案，如果 text_input 有內容，我們也應該產生輸出
        if not prompts_groups:
            # 如果只有全域輸入，就只處理全域輸入
            combinations = [([],)] if base_text_cleaned or base_loras else []
        else:
            combinations = list(itertools.product(*prompts_groups))
        
        final_models = []
        final_clips = []
        final_prompts = []
        final_conditionings = []

        # 4. 針對每種組合應用對應的 LoRA 與 Prompt
        for combo in combinations:
            # 組合文字
            current_texts = []
            
            # [新增] 插入全域 Prompt 到第一行
            if base_text_cleaned:
                current_texts.append(base_text_cleaned)
            
            # 加入組合中的文字
            current_texts.extend([item[0] for item in combo if item and item[0]])
            
            combined_prompt = delimiter.join(current_texts)
            
            # 收集該組合內的所有 LoRA
            all_loras = []
            
            # [新增] 加入全域 Prompt 中的 LoRA
            if base_loras:
                all_loras.extend(base_loras)
                
            for item in combo:
                if item: # item 可能是空的 tuple (如果上面 product 產生了空項目)
                    all_loras.extend(item[1]) 
            
            current_model = model
            current_clip = clip
            
            # 動態掛載 LoRA
            if current_model is not None and current_clip is not None and all_loras:
                for lora_name, strength in all_loras:
                    current_model, current_clip = self._load_lora(current_model, current_clip, lora_name, strength, strength)
            
            # CLIP 編碼 (轉為 Conditioning)
            current_conditioning = None
            if current_clip is not None:
                try:
                    tokens = current_clip.tokenize(combined_prompt)
                    cond, pooled = current_clip.encode_from_tokens(tokens, return_pooled=True)
                    current_conditioning = [[cond, {"pooled_output": pooled}]]
                except Exception as e:
                    print(f"[DynamicTagLoader] Error encoding prompt: {e}")

            # 加入輸出列表
            # 如果沒有任何產出(空列表)，就不加入(避免報錯)，或者保留空字串
            final_models.append(current_model)
            final_clips.append(current_clip)
            final_prompts.append(combined_prompt)
            final_conditionings.append(current_conditioning)

        print(f"JS Loader: Generated {len(final_prompts)} combinations.")
        
        # 防止空列表導致 ComfyUI 報錯
        if not final_prompts:
             return ([], [], [], [])
             
        return (final_models, final_clips, final_conditionings, final_prompts)