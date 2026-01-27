import { app } from "../../scripts/app.js";
import { api } from "../../scripts/api.js";

app.registerExtension({
    name: "DynamicTags.ImageDrop",
    async beforeRegisterNodeDef(nodeType, nodeData, app) {
        if (nodeData.name === "WorkflowMetadataReader") {

            // =============================================================================
            // Helper: 圖片上傳處理
            // =============================================================================
            async function uploadFile(file, node) {
                try {
                    const body = new FormData();
                    body.append("image", file);
                    body.append("overwrite", "true");

                    const resp = await api.fetchApi("/upload/image", {
                        method: "POST",
                        body,
                    });

                    if (resp.status === 200) {
                        const data = await resp.json();
                        const filename = data.name;

                        const pathWidget = node.widgets.find(w => w.name === "image_or_dir");
                        if (pathWidget) {
                            pathWidget.value = filename;
                            node.setDirtyCanvas(true, true);
                        }
                    } else {
                        alert(`Upload failed: ${resp.statusText}`);
                    }
                } catch (error) {
                    console.error("Upload error:", error);
                }
            }

            // =============================================================================
            // Logic 1: 拖曳 (Drag & Drop) 事件攔截
            // =============================================================================
            
            const onDragOverOriginal = nodeType.prototype.onDragOver;
            nodeType.prototype.onDragOver = function(e) {
                if (onDragOverOriginal) onDragOverOriginal.apply(this, arguments);
                return true; 
            };

            const onDragDropOriginal = nodeType.prototype.onDragDrop;
            nodeType.prototype.onDragDrop = function(e) {
                if (onDragDropOriginal) onDragDropOriginal.apply(this, arguments);

                if (e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files.length > 0) {
                    const file = e.dataTransfer.files[0];
                    
                    if (file.type.startsWith("image/")) {
                        e.preventDefault();
                        e.stopPropagation();
                        
                        uploadFile(file, this);
                        return true;
                    }
                }
                return false;
            };

            // =============================================================================
            // Logic 2: 剪貼簿 (Paste) 事件攔截
            // =============================================================================
            
            const onSelectedOriginal = nodeType.prototype.onSelected;
            nodeType.prototype.onSelected = function() {
                if (onSelectedOriginal) onSelectedOriginal.apply(this, arguments);
                
                this._pasteHandler = (e) => {
                    if (!app.canvas.selected_nodes || !app.canvas.selected_nodes[this.id]) return;

                    if (e.clipboardData && e.clipboardData.files && e.clipboardData.files.length > 0) {
                        const file = e.clipboardData.files[0];
                        if (file.type.startsWith("image/")) {
                            e.preventDefault();
                            e.stopPropagation();
                            e.stopImmediatePropagation();
                            
                            uploadFile(file, this);
                        }
                    }
                };

                window.addEventListener("paste", this._pasteHandler, true);
            };

            const onDeselectedOriginal = nodeType.prototype.onDeselected;
            nodeType.prototype.onDeselected = function() {
                if (onDeselectedOriginal) onDeselectedOriginal.apply(this, arguments);
                
                if (this._pasteHandler) {
                    window.removeEventListener("paste", this._pasteHandler, true);
                    this._pasteHandler = null;
                }
            };
        }
    }
});