import random

class DynamicTagIterator:
    @classmethod
    def INPUT_TYPES(s):
        return {
            "required": {
                "model": ("MODEL",),
                "clip": ("CLIP",),
                "conditioning": ("CONDITIONING",),
                "prompt": ("STRING",),
                
                "output_mode": (["Iterate (One by One)", "Batch (List)"], {"default": "Iterate (One by One)"}),
                "sample_limit": ("INT", {"default": 0, "min": 0, "max": 99999, "step": 1, "tooltip": "0 = Use All. If > 0, randomly select N items based on seed."}),
                
                # Seed 控制
                "seed": ("INT", {"default": 0, "min": 0, "max": 0xffffffffffffffff}),
            }
        }

    INPUT_IS_LIST = True
    
    RETURN_TYPES = ("MODEL", "CLIP", "CONDITIONING", "STRING")
    RETURN_NAMES = ("model", "clip", "positive", "prompt")
    OUTPUT_IS_LIST = (True, True, True, True)
    
    FUNCTION = "process"
    CATEGORY = "Custom/TagLoader"

    def process(self, model, clip, conditioning, prompt, output_mode, sample_limit, seed):
        mode = output_mode[0]
        limit = sample_limit[0]
        current_seed = seed[0]

        total_items = len(prompt)
        
        # 預設輸出
        final_models = []
        final_clips = []
        final_conditionings = []
        final_prompts = []

        if total_items > 0:
            indices = list(range(total_items))

            if limit > 0 and limit < total_items:
                rng = random.Random(current_seed)
                rng.shuffle(indices)
                selected_indices = indices[:limit]
            else:
                selected_indices = indices

            if mode == "Batch (List)":
                for idx in selected_indices:
                    final_models.append(model[idx])
                    final_clips.append(clip[idx])
                    final_conditionings.append(conditioning[idx])
                    final_prompts.append(prompt[idx])
                
                print(f"[TagIterator] Mode: Batch | Seed: {current_seed} | Output Count: {len(final_prompts)}")
            
            else: # Iterate
                if limit > 0:
                    actual_index = selected_indices[0] # 隨機抽樣後的第一個
                    seq_info = "Random Sample"
                else:
                    seq_index = current_seed % len(selected_indices)
                    actual_index = selected_indices[seq_index]
                    seq_info = f"Seq: {seq_index + 1}/{len(selected_indices)}"
                
                final_models.append(model[actual_index])
                final_clips.append(clip[actual_index])
                final_conditionings.append(conditioning[actual_index])
                final_prompts.append(prompt[actual_index])
                
                print(f"[TagIterator] Mode: Iterate | Seed: {current_seed} | {seq_info}")

        # [關鍵修改] 回傳格式改為字典，包含 UI 資料與 Result
        return {
            "ui": {
                "executed_seed": [current_seed]  # 傳送 Seed 給前端
            },
            "result": (final_models, final_clips, final_conditionings, final_prompts)
        }