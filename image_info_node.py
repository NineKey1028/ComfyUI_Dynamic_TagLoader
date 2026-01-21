import os
import json
import torch
import numpy as np
from PIL import Image, ImageOps

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

    # 修改輸出類型：將原本的 raw_info (STRING) 改為 image (IMAGE)
    RETURN_TYPES = ("JSON", "STRING", "STRING", "IMAGE")
    RETURN_NAMES = ("workflow_json", "clean_text", "selected_path", "image")
    FUNCTION = "extract_info"
    CATEGORY = "DynamicTags"

    def extract_info(self, image_or_dir, search_by, search_query, seed):
        target_path = image_or_dir.strip()
        selected_file = ""

        # ==========================================
        # 1. 檔案選取邏輯
        # ==========================================
        if os.path.isfile(target_path):
            selected_file = target_path
        elif os.path.isdir(target_path):
            valid_extensions = ('.png', '.webp', '.jpg', '.jpeg')
            files = sorted([
                os.path.join(target_path, f) 
                for f in os.listdir(target_path) 
                if f.lower().endswith(valid_extensions)
            ])

            if not files:
                # 若無檔案，回傳一個空的黑色張量避免系統崩潰
                return ({}, "No images found", target_path, torch.zeros((1, 64, 64, 3)))

            index = seed % len(files)
            selected_file = files[index]
        else:
            return ({}, "Invalid path", target_path, torch.zeros((1, 64, 64, 3)))

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
                        if str(node.get("id")) == search_query.strip():
                            match = True
                    else:
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