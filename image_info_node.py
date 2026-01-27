import os
import json
import torch
import numpy as np
from PIL import Image, ImageOps
import folder_paths  # 新增：用於獲取 ComfyUI 的標準路徑

class ImageWorkflowExtractor:
    @classmethod
    def INPUT_TYPES(s):
        return {
            "required": {
                "image_or_dir": ("STRING", {"default": "C:/ComfyUI/output"}),
                "search_by": (["ID", "Type"], {"default": "ID"}),
                "search_query": ("STRING", {"default": "00"}),
                "seed": ("INT", {"default": 0, "min": 0, "max": 0xffffffffffffffff}),
            },
        }

    RETURN_TYPES = ("JSON", "STRING", "STRING", "IMAGE")
    RETURN_NAMES = ("workflow_json", "clean_text", "selected_path", "image")
    FUNCTION = "extract_info"
    CATEGORY = "DynamicTags"

    def extract_info(self, image_or_dir, search_by, search_query, seed):
        target_path = image_or_dir.strip()
        
        # ==========================================
        # 0. 智慧路徑解析 (支援絕對路徑與上傳路徑)
        # ==========================================
        # 邏輯：先檢查是否為電腦上的絕對路徑 -> 再檢查 ComfyUI input 資料夾 -> 最後檢查 output 資料夾
        
        final_path = target_path
        
        if os.path.exists(target_path):
            final_path = os.path.abspath(target_path)
        else:
            # 嘗試從 input 資料夾尋找 (這是 Drag & Drop 上傳的預設位置)
            input_dir = folder_paths.get_input_directory()
            input_path = os.path.join(input_dir, target_path)
            
            # 嘗試從 output 資料夾尋找
            output_dir = folder_paths.get_output_directory()
            output_path = os.path.join(output_dir, target_path)

            if os.path.exists(input_path):
                final_path = input_path
            elif os.path.exists(output_path):
                final_path = output_path
            else:
                # 如果都找不到，保持原樣，讓後面的邏輯去報錯
                final_path = os.path.abspath(target_path)

        selected_file = ""

        # ==========================================
        # 1. 檔案選取邏輯 (單檔或資料夾隨機)
        # ==========================================
        if os.path.isfile(final_path):
            selected_file = final_path
        elif os.path.isdir(final_path):
            valid_extensions = ('.png', '.webp', '.jpg', '.jpeg')
            files = sorted([
                os.path.join(final_path, f) 
                for f in os.listdir(final_path) 
                if f.lower().endswith(valid_extensions)
            ])

            if not files:
                # 若無檔案，回傳一個空的黑色張量避免系統崩潰
                return ({}, "No images found", final_path, torch.zeros((1, 64, 64, 3)))

            index = seed % len(files)
            selected_file = files[index]
        else:
            return ({}, "Invalid path or file not found", final_path, torch.zeros((1, 64, 64, 3)))

        # ==========================================
        # 2. 資訊提取與圖像轉換輸出
        # ==========================================
        try:
            with Image.open(selected_file) as img:
                # --- A. 提取 Workflow Metadata ---
                info = img.info
                workflow = info.get("workflow", "{}")
                wf_data = json.loads(workflow) if isinstance(workflow, str) else workflow
                nodes = wf_data.get("nodes", [])

                clean_results = []
                for node in nodes:
                    match = False
                    if search_by == "ID":
                        # ID 轉字串比對
                        if str(node.get("id")) == search_query.strip():
                            match = True
                    else:
                        # Type 轉字串比對
                        if node.get("type") == search_query.strip():
                            match = True

                    if match:
                        values = node.get("widgets_values", [])
                        for val in values:
                            if isinstance(val, list):
                                for sub_val in val:
                                    clean_results.append(str(sub_val))
                            else:
                                clean_results.append(str(val))

                final_text = "\n".join(clean_results) if clean_results else f"No nodes match {search_query}"
                
                # --- B. 將圖片轉為 ComfyUI 格式 (IMAGE Tensor) ---
                # 修正圖片轉向 (Exif 資訊)
                img = ImageOps.exif_transpose(img)
                # 統一轉為 RGB
                image_rgb = img.convert("RGB")
                # 轉為 numpy 陣列並正規化至 0.0 ~ 1.0
                image_np = np.array(image_rgb).astype(np.float32) / 255.0
                # 轉為 PyTorch Tensor 並調整維度為 [Batch, Height, Width, Channel]
                image_tensor = torch.from_numpy(image_np)[None,]

                return (wf_data, final_text, selected_file, image_tensor)
        
        except Exception as e:
            # 發生錯誤時回傳錯誤訊息與空圖片
            return ({}, f"Error: {str(e)}", selected_file, torch.zeros((1, 64, 64, 3)))