import os
import json
import folder_paths

# 初始化基礎路徑：設定存檔根目錄為當前節點目錄下的 "tags"
NODE_FILE_PATH = os.path.dirname(os.path.abspath(__file__))
TAGS_DIR = os.path.join(NODE_FILE_PATH, "tags")

class DynamicTagSaver:
    @classmethod
    def INPUT_TYPES(s):
        return {
            "required": {
                # 主要輸入：Prompt 文本
                "text": ("STRING", {"multiline": True, "dynamicPrompts": False, "placeholder": "Input prompts here..."}),
                # 資料夾名稱 (預設 new_folder)
                "folder_name": ("STRING", {"default": "new_folder", "multiline": False}),
                # 檔案名稱 (預設 my_prompt)
                "filename": ("STRING", {"default": "my_prompt", "multiline": False}),
                # 隱藏輸入：接收前端傳來的 LoRA JSON 設定字串
                "lora_settings": ("STRING", {"default": "{}", "multiline": False, "hidden": True}),
            },
        }

    # 節點屬性定義
    RETURN_TYPES = ("STRING",)
    RETURN_NAMES = ("saved_info",) # 回傳存檔結果資訊
    FUNCTION = "save_tag"
    CATEGORY = "Custom/TagLoader"
    OUTPUT_NODE = True 

    def save_tag(self, text, folder_name, filename, lora_settings="{}"):
        # 去除頭尾空白
        content_to_save = text.strip()
        
        # ---------------------------
        # 1. 處理 LoRA 設定 (解析 JSON 並附加至文本)
        # ---------------------------
        try:
            settings = json.loads(lora_settings)
        except Exception as e:
            print(f"[DynamicTagSaver] JSON Parse Error: {e}")
            settings = {}

        loras_to_add = []
        
        # 依索引值排序，確保 LoRA 疊加順序正確
        sorted_keys = sorted(settings.keys(), key=lambda x: int(x))
        
        for key in sorted_keys:
            item = settings[key]
            lora_name = item.get("lora_name")
            strength = item.get("strength", 1.0)
            
            # 排除無效或 None 的 LoRA
            if lora_name and lora_name != "None":
                # 格式化為標準 Prompt 語法: <lora:Filename:1.0>
                loras_to_add.append(f"<lora:{lora_name}:{strength}>")

        # 若有 LoRA，則換行並附加到主要文本後方
        if loras_to_add:
            content_to_save += "\n" + "\n".join(loras_to_add)

        # ---------------------------
        # 2. 處理資料夾路徑與安全性
        # ---------------------------
        # 過濾資料夾名稱中的非法字元
        safe_folder = "".join(c for c in folder_name if c.isalnum() or c in (' ', '_', '-')).strip()
        if not safe_folder: 
            safe_folder = "default_folder"
            
        target_dir = os.path.join(TAGS_DIR, safe_folder)
        
        # 建立目錄 (若不存在)
        if not os.path.exists(target_dir):
            try:
                os.makedirs(target_dir)
            except Exception as e:
                return (f"Error creating directory: {e}",)

        # ---------------------------
        # 3. 處理檔名與重複檢查
        # ---------------------------
        # 確保有 .txt 副檔名並過濾非法字元
        base_name = filename if filename.endswith(".txt") else f"{filename}.txt"
        base_name = "".join(c for c in base_name if c.isalnum() or c in (' ', '_', '-', '.'))
        
        file_path = os.path.join(target_dir, base_name)
        
        # 若檔案已存在，自動添加流水號 (如: file_1.txt, file_2.txt)
        if os.path.exists(file_path):
            name, ext = os.path.splitext(base_name)
            counter = 1
            while os.path.exists(file_path):
                file_path = os.path.join(target_dir, f"{name}_{counter}{ext}")
                counter += 1
        
        # ---------------------------
        # 4. 寫入檔案
        # ---------------------------
        try:
            with open(file_path, "w", encoding="utf-8") as f:
                f.write(content_to_save)
            
            print(f"[DynamicTagSaver] Saved to: {file_path}")
            # 回傳成功訊息與內容預覽
            result_text = f"Saved: {os.path.basename(file_path)}\nLocation: {safe_folder}\n\nContent Preview:\n{content_to_save}"
        except Exception as e:
            print(f"[DynamicTagSaver] Write Error: {e}")
            result_text = f"Error saving file: {e}"

        return (result_text,)