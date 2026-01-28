class AnyType(str):
    def __ne__(self, __value: object) -> bool:
        return False

any_type = AnyType("*")

class WaitForNode:
    """
    強迫工作流等待特定節點執行完畢。
    用於控制 ComfyUI 執行的完成順序。
    """
    def __init__(self):
        pass

    @classmethod
    def INPUT_TYPES(s):
        return {
            "required": {
                "data_input": (any_type,),  # 主要流轉的數據
            },
            "optional": {
                "wait_for": (any_type,),    # 必須先完成的目標
            }
        }

    RETURN_TYPES = (any_type,)
    RETURN_NAMES = ("data_output",)
    FUNCTION = "execute_wait"
    CATEGORY = "DynamicTag/FlowControl"

    def execute_wait(self, data_input, wait_for=None):
        return (data_input,)