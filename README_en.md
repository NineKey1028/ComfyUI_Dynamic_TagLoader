<h1 align="center">
    ComfyUI_Dynamic_TagLoader
</h1>

## 🔗 Quick Links

* [English Version](./README_en.md)
* [日本語版](./README_jp.md)
* [中文版](./README.md)


<img width="1465" height="849" alt="ComfyUI_Dynamic_TagLoader_01" src="https://github.com/user-attachments/assets/517a9b69-e150-4ef6-aec1-b0ffcae43ab7" />


## Installation

Navigate to your ComfyUI `custom_nodes` directory:

```bash
cd ComfyUI/custom_nodes/
git clone https://github.com/NineKey1028/ComfyUI_Dynamic_TagLoader.git

```

Restart ComfyUI.

### ⚡ Dynamic Tag Loader
> Quickly read and sort organized `.txt` files from tag folders. Supports LoRA reading and can be connected to the 🔄 **Dynamic Tag Iterator** for random prompts and batch output.
> <details>
>     <summary><i>More...</i></summary>
>
>    * **Global Prompt**: Always appears on the first line of all output combinations.
>    * **+ Add Tag Group**: Click to add a new folder to read; you can add unlimited groups as needed.
>    * **Tag Group**:
>    * **Folder**: The current folder being read. Click to open a menu and switch folders.
>    * **File**: The file currently selected in the folder. Choosing **ALL** will combine all `.txt` files in this folder with files from other groups for full combinatorial output.
>    * **LoRA Support**: Supports writing `<lora:lora_name:weight>` directly in `.txt` files or the Global Prompt. The node automatically extracts the syntax, loads model weights, and cleans the syntax from the final prompt.
>    * **Context Menu**: Right-click any Tag Group to "Move Up/Down," "Move to Top/Bottom," "Insert New Group," or "Delete Group."
>    </details>

### 🔄 Dynamic Tag Iterator
> Receives the combination list from the Dynamic Tag Loader and performs single iterations or batch outputs based on settings.
> <details>
>    <summary><i>More...</i></summary>
>
>    * **Output Mode**:
>    * **Iterate (One by One)**: Works with ComfyUI's queue mechanism. Outputs one combination per execution (switches index order based on Seed).
>    * **Batch (List)**: Outputs all combinations (or a filtered list) at once, suitable for nodes that support list processing.
>    * **Sample Limit**: Sampling restriction. Set to 0 to use all combinations; if > 0, it randomly selects a specified number of items from the pool based on the current Seed.
>    * **Seed Control & Records**:
>    * The node determines the iteration index or random sampling order based on the Seed.
>    * **♻️ Reuse Last Seed**: Automatically records the Seed from the last successful run. Click to quickly fill it back into the Seed input to reproduce specific combinations.
>    </details>

### 💾 Dynamic Tag Saver
> Saves prompt text instantly as a `.txt` tag file and automatically integrates selected LoRA syntax. Helps users build personal tag libraries for future use with the Dynamic Tag Loader.
> <details>
>    <summary><i>More...</i></summary>
>
>    * **Text Input**: The main prompt input area. Extra spaces are trimmed automatically.
>    * **Folder & Filename**:
>    * **Folder Name**: Specify the save directory. If it doesn't exist, it will be created (within the `tags` folder in the node directory).
>    * **Filename**: Specify the file name. If a duplicate exists, a suffix (e.g., `_1`, `_2`) is added to prevent overwriting.
>    * **LoRA Auto Merge**:
>    * **+ Add LoRA**: Opens a search menu to select installed LoRA files.
>    * **Strength**: Adjust weights (supports -10.0 to 10.0).
>    * **Auto Integration**: Upon saving, selected LoRAs are converted to `<lora:name:weight>` and appended to the text.
>    * **Advanced Menu**: Right-click the LoRA block to reorder or delete entries.
>    </details>

### 🔍 Workflow Metadata Reader
> Extracts complete Workflow JSON data from generated images (PNG). It retrieves content based on Node IDs to output prompts and images. Supports single image parsing or random selection from a directory.
> <details>
>    <summary><i>More...</i></summary>
>
>    * **image_or_dir**: Input a file path or a directory path.
>    * **Search By**:
>    * **ID**: Locates and extracts all widget values (Prompt, Seed, etc.) via Node ID.
>    * **Type**: Filters and extracts text based on node type (e.g., `CLIPTextEncode`).
>    * **Selection Logic**:
>    * **Directory Mode**: Uses the **Seed** to randomly sample images from a folder.
>    * **Single Image Mode**: Reads info from a specific file.
>    * **Note**: Supports Drag & Drop or `Ctrl+V` to paste images (copies them to the `input` folder).
>
>    ⚠️ **Warning**: For prompts to be read correctly, the workflow should use a node like **Show Text** and the prompt must be written to the metadata *before* image generation. If execution order issues occur, use the **⏳ Wait For** node.
>    </details>

### ⏳ Wait For

> Forces execution order in ComfyUI's non-linear environment. Ensures a "Target Node" finishes before the subsequent node begins.
> <details>
>    <summary><i>More...</i></summary>
>
>    * **Data Input**: The primary data to pass through (AnyType).
>    * **Wait For (Optional)**: Connect to the output of the node you want to finish first. Data is only released once this connection receives data.
>    </details>

Example Workflows:
![example](./example/Dynamic_Tag_example_workflow.png)
![example](./example/Workflow_Metadata_Reader_example_workflow.png)
You can drag these into ComfyUI to load and read the example workflows.