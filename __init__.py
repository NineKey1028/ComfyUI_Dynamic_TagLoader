import os
import folder_paths
from .loader_node import DynamicTagLoaderJS
from .saver_node import DynamicTagSaver
from .iterator_node import DynamicTagIterator  # [新增] 匯入新節點

# 嘗試導入 ComfyUI 伺服器模組
try:
    from server import PromptServer
    from aiohttp import web
except ImportError:
    PromptServer = None
    web = None

# 初始化路徑配置：確保 tags 目錄存在
NODE_FILE_PATH = os.path.dirname(os.path.abspath(__file__))
TAGS_DIR = os.path.join(NODE_FILE_PATH, "tags")

if not os.path.exists(TAGS_DIR):
    os.makedirs(TAGS_DIR)

# 註冊 API 路由
if PromptServer:
    
    # API: 讀取 tags 資料夾結構與 .txt 檔案列表
    @PromptServer.instance.routes.get("/custom_nodes/tags")
    async def get_tags_data(request):
        data = {}
        if os.path.exists(TAGS_DIR):
            # 取得所有子目錄
            subdirs = sorted([d for d in os.listdir(TAGS_DIR) if os.path.isdir(os.path.join(TAGS_DIR, d))])
            for subdir in subdirs:
                subdir_path = os.path.join(TAGS_DIR, subdir)
                # 取得子目錄下的 .txt 檔案
                files = sorted([f for f in os.listdir(subdir_path) if f.endswith(".txt")])
                data[subdir] = ["ALL"] + files
        return web.json_response(data)

    # API: 獲取 ComfyUI 系統內可用的 LoRA 列表 (供前端 JS 使用)
    @PromptServer.instance.routes.get("/custom_nodes/loras_list")
    async def get_loras_list(request):
        loras = folder_paths.get_filename_list("loras")
        return web.json_response(loras)

# 節點類別映射
NODE_CLASS_MAPPINGS = {
    "DynamicTagLoaderJS": DynamicTagLoaderJS,
    "DynamicTagSaver": DynamicTagSaver,
    "DynamicTagIterator": DynamicTagIterator  # [新增] 註冊類別
}

# 節點顯示名稱映射
NODE_DISPLAY_NAME_MAPPINGS = {
    "DynamicTagLoaderJS": "⚡Dynamic Tag Loader",
    "DynamicTagSaver": "💾 Dynamic Tag Saver",
    "DynamicTagIterator": "🔄 Dynamic Tag Iterator" # [新增] 顯示名稱
}

# 前端資源目錄
WEB_DIRECTORY = "./web"

__all__ = ["NODE_CLASS_MAPPINGS", "NODE_DISPLAY_NAME_MAPPINGS", "WEB_DIRECTORY"]