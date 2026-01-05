import os
import itertools
import re
import json
import folder_paths
import comfy.sd
import comfy.utils

NODE_FILE_PATH = os.path.dirname(os.path.abspath(__file__))
TAGS_DIR = os.path.join(NODE_FILE_PATH, "tags")

class DynamicTagLoaderJS:
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

    # [修改] 新增一個 INT 類型的輸出: count
    RETURN_TYPES = ("MODEL", "CLIP", "CONDITIONING", "STRING", "INT")
    RETURN_NAMES = ("model", "clip", "positive", "prompt", "count")
    OUTPUT_IS_LIST = (True, True, True, True, False) # count 不是 list，是單一數值
    
    FUNCTION = "process"
    CATEGORY = "Custom/TagLoader"

    @classmethod
    def IS_CHANGED(s, **kwargs):
        return float("nan")

    def _parse_and_strip_lora(self, text):
        if not text:
            return "", []
        lora_pattern = r"<lora:([^>:]+)(?::([0-9.]+))?>"
        found_loras = []
        for match in re.finditer(lora_pattern, text):
            lora_name = match.group(1)
            strength = float(match.group(2)) if match.group(2) else 1.0
            found_loras.append((lora_name, strength))
        cleaned_text = re.sub(lora_pattern, "", text)
        cleaned_text = re.sub(r'\n\s*\n', '\n', cleaned_text)
        cleaned_text = cleaned_text.strip()
        return cleaned_text, found_loras

    def _load_lora(self, model, clip, lora_name, strength_model, strength_clip):
        if model is None or clip is None:
            return model, clip
        lora_path = folder_paths.get_full_path("loras", lora_name)
        if lora_path is None:
            lora_path = folder_paths.get_full_path("loras", f"{lora_name}.safetensors")
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
        try:
            with open(path, 'r', encoding='utf-8') as f:
                return f.read().strip()
        except:
            return None

    def process(self, text_input, tag_settings, model=None, clip=None, **kwargs):
        delimiter = "\n" 
        try:
            settings = json.loads(tag_settings)
        except Exception as e:
            settings = {}

        base_text_cleaned, base_loras = self._parse_and_strip_lora(text_input)
        prompts_groups = []
        sorted_keys = sorted(settings.keys(), key=lambda x: int(x))
        
        for key in sorted_keys:
            item = settings[key]
            item_type = item.get("type", "file")

            if item_type == "text":
                raw_text = item.get("text", "")
                if raw_text:
                    cleaned_text, loras = self._parse_and_strip_lora(raw_text)
                    prompts_groups.append([(cleaned_text, loras)])
            else:
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
                    if raw_content is not None:
                        cleaned_text, loras = self._parse_and_strip_lora(raw_content)
                        current_group_data.append((cleaned_text, loras))
                
                if current_group_data:
                    prompts_groups.append(current_group_data)

        if not prompts_groups:
            combinations = [([],)] if base_text_cleaned or base_loras else []
        else:
            combinations = list(itertools.product(*prompts_groups))
        
        final_models = []
        final_clips = []
        final_prompts = []
        final_conditionings = []

        for combo in combinations:
            current_texts = []
            if base_text_cleaned:
                current_texts.append(base_text_cleaned)
            current_texts.extend([item[0] for item in combo if item and item[0]])
            combined_prompt = delimiter.join(current_texts)
            
            all_loras = []
            if base_loras:
                all_loras.extend(base_loras)
            for item in combo:
                if item:
                    all_loras.extend(item[1]) 
            
            current_model = model
            current_clip = clip
            if current_model is not None and current_clip is not None and all_loras:
                for lora_name, strength in all_loras:
                    current_model, current_clip = self._load_lora(current_model, current_clip, lora_name, strength, strength)
            
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
        
        # [修改] 回傳值多了一個 count
        return (final_models, final_clips, final_conditionings, final_prompts, count)