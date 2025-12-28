ComfyUI Dynamic Tag & LoRA Manager
這是一個強大的 ComfyUI 擴充插件，旨在解決 Prompt 管理與 LoRA 組合繁瑣的問題。它包含兩個核心節點：Saver（存檔） 與 Loader（讀取與生成）。

透過這個插件，您可以將常用的 Prompt 與 LoRA 設定儲存為模組化的文本，並在生成時透過「排列組合」的方式，自動讀取文本中的 LoRA 標籤並掛載模型，實現高效率的批量生成。

✨ 主要功能 (Key Features)
💾 Dynamic Tag Saver (動態標籤存檔器)
視覺化 LoRA 管理：透過 UI 下拉選單直接選擇系統內的 LoRA，並調整權重。

自動格式化：將 Prompt 與 LoRA 設定自動合併，存成 .txt 檔案。

分類管理：支援自定義資料夾與檔名，自動處理檔名衝突（流水號）。

搜尋功能：內建 LoRA 搜尋選單，快速找到您需要的模型。

⚡ Dynamic Tag Loader (動態標籤讀取器)
自動掛載 LoRA：讀取文本時，自動解析 <lora:...> 語法，並直接將 LoRA 應用到 MODEL 與 CLIP 輸出，無需手動連接多個 LoRA Loader。

排列組合生成 (Batch Generator)：

支援多組標籤輸入。

若選擇「資料夾 (ALL)」，會自動讀取該資料夾下所有檔案。

自動計算所有組合，例如：背景組(3個檔案) x 角色組(4個檔案) = 一次生成 12 張不同組合的圖片。

模糊搜尋機制：即便存檔時的 LoRA 路徑與當前環境不同，插件也會嘗試透過檔名自動尋找對應的 LoRA 模型。

全域 Prompt：支援輸入固定的一段文字（如畫質修飾詞），會自動添加到所有生成的組合最前方。

📦 安裝說明 (Installation)
進入您的 ComfyUI custom_nodes 目錄：

Bash
```
cd ComfyUI/custom_nodes/
```

Bash

```
git clone https://github.com/NineKey1028/ComfyUI_Dynamic_TagLoader.git
```

重新啟動 ComfyUI。

📖 使用教學 (Usage Guide)
1. 💾 Dynamic Tag Saver
這個節點用於將您的靈感保存下來。

Text Input: 輸入您的主要 Prompt。

Folder / Filename: 設定存檔的資料夾與檔名（檔案將存於插件目錄下的 tags/ 資料夾中）。

+ Add LoRA:

點擊按鈕開啟選單。

可關鍵字搜尋。

加入後可調整強度 (Strength)，支援右鍵選單進行排序 (Move Up/Down) 或刪除。

執行: 連接任意輸出並執行 Prompt，檔案即會建立。



2. ⚡ Dynamic Tag Loader
這個節點是核心，它是一個 Generator，可直接連接到 KSampler。

Global Prompt: 輸入通用的 Prompt（例如 masterpiece, best quality），這段文字會加在所有組合的最前面。

+ Add Tag Group:

選擇一個資料夾 (Folder)。

選擇一個檔案 (File)，或選擇 "ALL" 來讀取該資料夾內所有檔案。

您可以新增多個群組，節點會自動將它們混合搭配。

輸出連接:

MODEL / CLIP: 已自動掛載好 LoRA 的模型，直接連到 KSampler。

STRING: 組合後的完整 Prompt，連到 CLIP Text Encode。

🚀 工作流範例 (Workflow Example)
場景：您想要測試 3 種不同的服裝 LoRA，配合 2 種不同的背景 Prompt。

使用 Saver：

建立資料夾 Costumes，分別儲存 3 個檔案（包含對應的 LoRA 設定）。

建立資料夾 Backgrounds，分別儲存 2 個背景描述檔。

使用 Loader：

Group 1 選擇 Costumes -> ALL。

Group 2 選擇 Backgrounds -> ALL。

執行：

Loader 會自動輸出 3 x 2 = 6 組變數。

ComfyUI 將自動連續生成 6 張圖片，每張圖都應用了正確的 LoRA 和背景。

📂 檔案結構 (Directory Structure)
您的標籤檔案將儲存在插件目錄下的 tags 資料夾中，結構如下：

ComfyUI/
└── custom_nodes/
    └── ComfyUI-Dynamic-Tag-Manager/
        ├── tags/                # 所有存檔都在這裡
        │   ├── my_folder_A/
        │   │   ├── prompt1.txt
        │   │   └── prompt2.txt
        │   └── character_loras/
        │       └── miku.txt
        ├── dynamic_loader.js
        ├── dynamic_saver.js
        ├── loader_node.py
        ├── saver_node.py
        └── ...
⚠️ 注意事項
Batch Size: 由於 Loader 輸出的是列表（List），請確保後續節點支援批次處理。通常 ComfyUI 會自動處理列表執行。

LoRA 路徑: 雖然內建模糊搜尋，但建議保持 LoRA 檔案名稱的一致性以確保讀取正確。

License
MIT License
