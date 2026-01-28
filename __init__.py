import os
import folder_paths
from .loader_node import DynamicTagLoaderJS
from .saver_node import DynamicTagSaver
from .iterator_node import DynamicTagIterator
from .image_info_node import ImageWorkflowExtractor
from .wait_for_node import WaitForNode

# ==============================================================================
# 模組導入與環境檢查
# ==============================================================================
try:
    from server import PromptServer
    from aiohttp import web
except ImportError:
    PromptServer = None
    web = None

# ==============================================================================
# 全域路徑配置
# ==============================================================================
NODE_FILE_PATH = os.path.dirname(os.path.abspath(__file__))
TAGS_DIR = os.path.join(NODE_FILE_PATH, "tags")

# 若 tags 目錄不存在則自動建立，確保基本執行環境
if not os.path.exists(TAGS_DIR):
    os.makedirs(TAGS_DIR)

# ==============================================================================
# API 路由註冊 (Server-Side)
# ==============================================================================
if PromptServer:
    
    @PromptServer.instance.routes.get("/custom_nodes/tags")
    async def get_tags_data(request):
        """
        API: 獲取 Tags 目錄結構
        功能: 遞迴遍歷 tags 資料夾，回傳包含 .txt 檔案的目錄結構供前端選單使用。
        """
        data = {}
        if os.path.exists(TAGS_DIR):
            # 使用 os.walk 進行遞迴遍歷，以支援多層級子資料夾
            for root, dirs, files in os.walk(TAGS_DIR):
                # 篩選出目標檔案類型 (.txt)
                txt_files = sorted([f for f in files if f.endswith(".txt")])
                
                # 過濾空目錄：僅將包含有效 .txt 檔案的目錄加入索引
                if txt_files:
                    # 計算相對路徑 (例如: "Style/Anime")
                    rel_path = os.path.relpath(root, TAGS_DIR)
                    
                    # 根目錄標識處理
                    if rel_path == ".":
                        rel_path = "Root"
                    
                    # 跨平台相容性處理：統一使用 POSIX 風格路徑分隔符 (/) 以確保前端顯示一致
                    rel_path = rel_path.replace("\\", "/")
                    
                    # 建構回傳資料：加入 "ALL" 選項作為批次讀取標識
                    data[rel_path] = ["ALL"] + txt_files
                    
        return web.json_response(data)

    @PromptServer.instance.routes.get("/custom_nodes/loras_list")
    async def get_loras_list(request):
        """
        API: 獲取系統 LoRA 列表
        功能: 讀取 ComfyUI 系統路徑下的 LoRA 模型清單。
        """
        loras = folder_paths.get_filename_list("loras")
        return web.json_response(loras)

# ==============================================================================
# 節點映射與顯示名稱
# ==============================================================================
NODE_CLASS_MAPPINGS = {
    "DynamicTagLoaderJS": DynamicTagLoaderJS,
    "DynamicTagSaver": DynamicTagSaver,
    "DynamicTagIterator": DynamicTagIterator,
    "WorkflowMetadataReader": ImageWorkflowExtractor,
    "WaitForNode": WaitForNode,
}

NODE_DISPLAY_NAME_MAPPINGS = {
    "DynamicTagLoaderJS": "⚡Dynamic Tag Loader",
    "DynamicTagSaver": "💾 Dynamic Tag Saver",
    "DynamicTagIterator": "🔄 Dynamic Tag Iterator",
    "WorkflowMetadataReader": "🔍 Workflow Metadata Reader",
    "WaitForNode": "⏳ Wait For",
}

WEB_DIRECTORY = "./web"

__all__ = ["NODE_CLASS_MAPPINGS", "NODE_DISPLAY_NAME_MAPPINGS", "WEB_DIRECTORY"]