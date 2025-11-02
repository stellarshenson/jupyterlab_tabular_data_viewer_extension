"use strict";
(self["webpackChunkjupyterlab_parquet_viewer_extension"] = self["webpackChunkjupyterlab_parquet_viewer_extension"] || []).push([["lib_index_js"],{

/***/ "./lib/document.js":
/*!*************************!*\
  !*** ./lib/document.js ***!
  \*************************/
/***/ ((__unused_webpack_module, __webpack_exports__, __webpack_require__) => {

__webpack_require__.r(__webpack_exports__);
/* harmony export */ __webpack_require__.d(__webpack_exports__, {
/* harmony export */   ParquetDocument: () => (/* binding */ ParquetDocument)
/* harmony export */ });
/* harmony import */ var _jupyterlab_docregistry__WEBPACK_IMPORTED_MODULE_0__ = __webpack_require__(/*! @jupyterlab/docregistry */ "webpack/sharing/consume/default/@jupyterlab/docregistry");
/* harmony import */ var _jupyterlab_docregistry__WEBPACK_IMPORTED_MODULE_0___default = /*#__PURE__*/__webpack_require__.n(_jupyterlab_docregistry__WEBPACK_IMPORTED_MODULE_0__);

/**
 * A document widget for Parquet files
 */
class ParquetDocument extends _jupyterlab_docregistry__WEBPACK_IMPORTED_MODULE_0__.DocumentWidget {
    constructor(options) {
        super(options);
    }
}


/***/ }),

/***/ "./lib/index.js":
/*!**********************!*\
  !*** ./lib/index.js ***!
  \**********************/
/***/ ((__unused_webpack_module, __webpack_exports__, __webpack_require__) => {

__webpack_require__.r(__webpack_exports__);
/* harmony export */ __webpack_require__.d(__webpack_exports__, {
/* harmony export */   "default": () => (__WEBPACK_DEFAULT_EXPORT__)
/* harmony export */ });
/* harmony import */ var _jupyterlab_docregistry__WEBPACK_IMPORTED_MODULE_0__ = __webpack_require__(/*! @jupyterlab/docregistry */ "webpack/sharing/consume/default/@jupyterlab/docregistry");
/* harmony import */ var _jupyterlab_docregistry__WEBPACK_IMPORTED_MODULE_0___default = /*#__PURE__*/__webpack_require__.n(_jupyterlab_docregistry__WEBPACK_IMPORTED_MODULE_0__);
/* harmony import */ var _jupyterlab_settingregistry__WEBPACK_IMPORTED_MODULE_1__ = __webpack_require__(/*! @jupyterlab/settingregistry */ "webpack/sharing/consume/default/@jupyterlab/settingregistry");
/* harmony import */ var _jupyterlab_settingregistry__WEBPACK_IMPORTED_MODULE_1___default = /*#__PURE__*/__webpack_require__.n(_jupyterlab_settingregistry__WEBPACK_IMPORTED_MODULE_1__);
/* harmony import */ var _widget__WEBPACK_IMPORTED_MODULE_2__ = __webpack_require__(/*! ./widget */ "./lib/widget.js");
/* harmony import */ var _document__WEBPACK_IMPORTED_MODULE_3__ = __webpack_require__(/*! ./document */ "./lib/document.js");




/**
 * A widget factory for Parquet files
 */
class ParquetWidgetFactory extends _jupyterlab_docregistry__WEBPACK_IMPORTED_MODULE_0__.ABCWidgetFactory {
    constructor(options, setLastContextMenuRow, setActiveWidget) {
        super(options);
        this._setLastContextMenuRow = setLastContextMenuRow;
        this._setActiveWidget = setActiveWidget;
    }
    /**
     * Create a new widget given a context
     */
    createNewWidget(context) {
        var _a, _b;
        console.log(`[Parquet Viewer] Creating widget for file: ${context.path}`);
        console.log(`[Parquet Viewer] File type: ${(_a = context.contentsModel) === null || _a === void 0 ? void 0 : _a.type}, Format: ${(_b = context.contentsModel) === null || _b === void 0 ? void 0 : _b.format}`);
        const content = new _widget__WEBPACK_IMPORTED_MODULE_2__.ParquetViewer(context.path, this._setLastContextMenuRow);
        const widget = new _document__WEBPACK_IMPORTED_MODULE_3__.ParquetDocument({ content, context });
        widget.title.label = context.path.split('/').pop() || 'Parquet File';
        // Track this as the active widget when context menu is used
        this._setActiveWidget(content);
        return widget;
    }
}
/**
 * Initialization data for the jupyterlab_parquet_viewer_extension extension.
 */
const plugin = {
    id: 'jupyterlab_parquet_viewer_extension:plugin',
    description: 'Jupyterlab extension to allow simple browsing of the parquet files with basic data filtering capabilities',
    autoStart: true,
    requires: [_jupyterlab_settingregistry__WEBPACK_IMPORTED_MODULE_1__.ISettingRegistry],
    activate: async (app, settingRegistry) => {
        console.log('JupyterLab extension jupyterlab_parquet_viewer_extension is activated!');
        const { docRegistry, commands, contextMenu } = app;
        // Track last right-clicked row for context menu
        let lastContextMenuRow = null;
        let activeWidget = null;
        // Load settings
        let settings = {
            enableParquet: true,
            enableExcel: false
        };
        console.log('[Parquet Viewer] Default settings:', settings);
        try {
            console.log('[Parquet Viewer] Loading settings from registry with id:', plugin.id);
            const pluginSettings = await settingRegistry.load(plugin.id);
            settings = pluginSettings.composite;
            console.log('[Parquet Viewer] Loaded settings:', settings);
            console.log('[Parquet Viewer] Settings detail - enableParquet:', settings.enableParquet, 'enableExcel:', settings.enableExcel);
            // Watch for settings changes
            pluginSettings.changed.connect(() => {
                settings = pluginSettings.composite;
                console.log('[Parquet Viewer] Settings changed:', settings);
            });
        }
        catch (error) {
            console.error('[Parquet Viewer] Failed to load settings:', error);
            console.log('[Parquet Viewer] Using default settings:', settings);
        }
        // Command to copy row as JSON
        const copyRowCommand = 'parquet-viewer:copy-row-json';
        commands.addCommand(copyRowCommand, {
            label: 'Copy Row as JSON',
            caption: 'Copy the row data as JSON to clipboard',
            isEnabled: () => {
                return lastContextMenuRow !== null;
            },
            execute: async () => {
                if (lastContextMenuRow) {
                    const jsonString = JSON.stringify(lastContextMenuRow, null, 2);
                    await navigator.clipboard.writeText(jsonString);
                    console.log('Row copied to clipboard as JSON');
                    // Clean up highlight after copy
                    if (activeWidget) {
                        activeWidget.getCleanupHighlight()();
                    }
                }
            }
        });
        // Add to context menu for parquet viewer rows
        contextMenu.addItem({
            command: copyRowCommand,
            selector: '.jp-ParquetViewer-row',
            rank: 10
        });
        // Register file types based on settings
        console.log('[Parquet Viewer] Starting file type registration...');
        console.log('[Parquet Viewer] Current settings state:', settings);
        const binaryFileTypes = [];
        // Register Parquet file type if enabled
        if (settings.enableParquet) {
            try {
                docRegistry.addFileType({
                    name: 'parquet',
                    displayName: 'Parquet',
                    extensions: ['.parquet'],
                    mimeTypes: ['application/x-parquet'],
                    iconClass: 'jp-MaterialIcon jp-SpreadsheetIcon',
                    contentType: 'file',
                    fileFormat: 'base64'
                });
                binaryFileTypes.push('parquet');
                console.log('[Parquet Viewer] Parquet file type registered');
            }
            catch (e) {
                console.warn('[Parquet Viewer] Parquet file type already registered', e);
            }
        }
        // Register Excel file type if enabled
        if (settings.enableExcel) {
            try {
                docRegistry.addFileType({
                    name: 'xlsx-parquet-viewer',
                    displayName: 'Excel (Parquet Viewer)',
                    extensions: ['.xlsx'],
                    mimeTypes: ['application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'],
                    iconClass: 'jp-MaterialIcon jp-SpreadsheetIcon',
                    contentType: 'file',
                    fileFormat: 'base64'
                });
                binaryFileTypes.push('xlsx-parquet-viewer');
                console.log('[Parquet Viewer] Excel file type registered');
            }
            catch (e) {
                console.warn('[Parquet Viewer] Excel file type already registered', e);
            }
        }
        // Create binary factory for Parquet and Excel files
        if (binaryFileTypes.length > 0) {
            const binaryFactory = new ParquetWidgetFactory({
                name: 'Parquet Viewer (Binary)',
                modelName: 'base64',
                fileTypes: binaryFileTypes,
                defaultFor: binaryFileTypes,
                defaultRendered: binaryFileTypes,
                readOnly: true
            }, (row) => {
                lastContextMenuRow = row;
            }, (widget) => {
                activeWidget = widget;
            });
            docRegistry.addWidgetFactory(binaryFactory);
            console.log(`[Parquet Viewer] Binary factory registered for: ${binaryFileTypes.join(', ')}`);
        }
        else {
            console.warn('[Parquet Viewer] No file types enabled in settings');
        }
    }
};
/* harmony default export */ const __WEBPACK_DEFAULT_EXPORT__ = (plugin);


/***/ }),

/***/ "./lib/request.js":
/*!************************!*\
  !*** ./lib/request.js ***!
  \************************/
/***/ ((__unused_webpack_module, __webpack_exports__, __webpack_require__) => {

__webpack_require__.r(__webpack_exports__);
/* harmony export */ __webpack_require__.d(__webpack_exports__, {
/* harmony export */   requestAPI: () => (/* binding */ requestAPI)
/* harmony export */ });
/* harmony import */ var _jupyterlab_coreutils__WEBPACK_IMPORTED_MODULE_0__ = __webpack_require__(/*! @jupyterlab/coreutils */ "webpack/sharing/consume/default/@jupyterlab/coreutils");
/* harmony import */ var _jupyterlab_coreutils__WEBPACK_IMPORTED_MODULE_0___default = /*#__PURE__*/__webpack_require__.n(_jupyterlab_coreutils__WEBPACK_IMPORTED_MODULE_0__);
/* harmony import */ var _jupyterlab_services__WEBPACK_IMPORTED_MODULE_1__ = __webpack_require__(/*! @jupyterlab/services */ "webpack/sharing/consume/default/@jupyterlab/services");
/* harmony import */ var _jupyterlab_services__WEBPACK_IMPORTED_MODULE_1___default = /*#__PURE__*/__webpack_require__.n(_jupyterlab_services__WEBPACK_IMPORTED_MODULE_1__);


/**
 * Call the server extension
 *
 * @param endPoint API REST end point for the extension
 * @param init Initial values for the request
 * @returns The response body interpreted as JSON
 */
async function requestAPI(endPoint = '', init = {}) {
    // Make request to Jupyter API
    const settings = _jupyterlab_services__WEBPACK_IMPORTED_MODULE_1__.ServerConnection.makeSettings();
    const requestUrl = _jupyterlab_coreutils__WEBPACK_IMPORTED_MODULE_0__.URLExt.join(settings.baseUrl, 'jupyterlab-parquet-viewer-extension', // our server extension's API namespace
    endPoint);
    let response;
    try {
        response = await _jupyterlab_services__WEBPACK_IMPORTED_MODULE_1__.ServerConnection.makeRequest(requestUrl, init, settings);
    }
    catch (error) {
        throw new _jupyterlab_services__WEBPACK_IMPORTED_MODULE_1__.ServerConnection.NetworkError(error);
    }
    let data = await response.text();
    if (data.length > 0) {
        try {
            data = JSON.parse(data);
        }
        catch (error) {
            console.log('Not a JSON response body.', response);
        }
    }
    if (!response.ok) {
        throw new _jupyterlab_services__WEBPACK_IMPORTED_MODULE_1__.ServerConnection.ResponseError(response, data.message || data);
    }
    return data;
}


/***/ }),

/***/ "./lib/widget.js":
/*!***********************!*\
  !*** ./lib/widget.js ***!
  \***********************/
/***/ ((__unused_webpack_module, __webpack_exports__, __webpack_require__) => {

__webpack_require__.r(__webpack_exports__);
/* harmony export */ __webpack_require__.d(__webpack_exports__, {
/* harmony export */   ParquetViewer: () => (/* binding */ ParquetViewer)
/* harmony export */ });
/* harmony import */ var _lumino_widgets__WEBPACK_IMPORTED_MODULE_0__ = __webpack_require__(/*! @lumino/widgets */ "webpack/sharing/consume/default/@lumino/widgets");
/* harmony import */ var _lumino_widgets__WEBPACK_IMPORTED_MODULE_0___default = /*#__PURE__*/__webpack_require__.n(_lumino_widgets__WEBPACK_IMPORTED_MODULE_0__);
/* harmony import */ var _request__WEBPACK_IMPORTED_MODULE_1__ = __webpack_require__(/*! ./request */ "./lib/request.js");


/**
 * Parquet viewer widget
 */
class ParquetViewer extends _lumino_widgets__WEBPACK_IMPORTED_MODULE_0__.Widget {
    constructor(filePath, setLastContextMenuRow) {
        super();
        this._columns = [];
        this._data = [];
        this._totalRows = 0;
        this._unfilteredTotalRows = 0;
        this._currentOffset = 0;
        this._limit = 500;
        this._loading = false;
        this._hasMore = true;
        this._filters = {};
        this._sortBy = null;
        this._sortOrder = 'asc';
        this._fileSize = 0;
        this._caseInsensitive = false;
        this._useRegex = false;
        this._contextMenuOpen = false;
        this._columnWidths = new Map();
        this._resizing = null;
        this._cleanupHighlight = null;
        this._menuObserver = null;
        /**
         * Handle column resize drag
         */
        this._doResize = (e) => {
            if (!this._resizing) {
                return;
            }
            const deltaX = e.clientX - this._resizing.startX;
            const newWidth = Math.max(80, this._resizing.startWidth + deltaX); // Minimum width of 80px
            // Store the new width
            this._columnWidths.set(this._resizing.columnName, newWidth);
            // Apply the new width to the column header and filter cell only
            // With table-layout: fixed, this automatically applies to all cells in the column
            const columnIndex = this._columns.findIndex(col => col.name === this._resizing.columnName);
            if (columnIndex !== -1) {
                const headerCell = this._headerRow.children[columnIndex];
                const filterCell = this._filterRow.children[columnIndex];
                if (headerCell) {
                    headerCell.style.width = `${newWidth}px`;
                }
                if (filterCell) {
                    filterCell.style.width = `${newWidth}px`;
                }
                // Update table width to sum of all column widths
                const totalWidth = Array.from(this._columnWidths.values()).reduce((sum, w) => sum + w, 0);
                this._table.style.width = `${totalWidth}px`;
            }
        };
        /**
         * Stop column resize
         */
        this._stopResize = () => {
            if (!this._resizing) {
                return;
            }
            this._resizing = null;
            // Remove global mouse event listeners
            document.removeEventListener('mousemove', this._doResize);
            document.removeEventListener('mouseup', this._stopResize);
            // Restore user selection and cursor
            document.body.style.userSelect = '';
            document.body.style.cursor = '';
        };
        this._filePath = filePath;
        this._setLastContextMenuRow = setLastContextMenuRow;
        this.addClass('jp-ParquetViewer');
        // Create table container (scrollable)
        this._tableContainer = document.createElement('div');
        this._tableContainer.className = 'jp-ParquetViewer-container';
        // Create table
        this._table = document.createElement('table');
        this._table.className = 'jp-ParquetViewer-table';
        this._thead = document.createElement('thead');
        this._thead.className = 'jp-ParquetViewer-thead';
        this._tbody = document.createElement('tbody');
        this._tbody.className = 'jp-ParquetViewer-tbody';
        // Create filter row
        this._filterRow = document.createElement('tr');
        this._filterRow.className = 'jp-ParquetViewer-filterRow';
        // Create header row
        this._headerRow = document.createElement('tr');
        this._headerRow.className = 'jp-ParquetViewer-headerRow';
        this._thead.appendChild(this._filterRow);
        this._thead.appendChild(this._headerRow);
        this._table.appendChild(this._thead);
        this._table.appendChild(this._tbody);
        this._tableContainer.appendChild(this._table);
        // Create status bar (outside scroll container)
        this._statusBar = document.createElement('div');
        this._statusBar.className = 'jp-ParquetViewer-statusBar';
        this._statusLeft = document.createElement('div');
        this._statusLeft.className = 'jp-ParquetViewer-statusLeft';
        // Create middle section with case-insensitive checkbox
        const statusMiddle = document.createElement('div');
        statusMiddle.className = 'jp-ParquetViewer-statusMiddle';
        const checkboxLabel = document.createElement('label');
        checkboxLabel.className = 'jp-ParquetViewer-caseInsensitiveLabel';
        this._caseInsensitiveCheckbox = document.createElement('input');
        this._caseInsensitiveCheckbox.type = 'checkbox';
        this._caseInsensitiveCheckbox.className = 'jp-ParquetViewer-caseInsensitiveCheckbox';
        this._caseInsensitiveCheckbox.checked = this._caseInsensitive;
        this._caseInsensitiveCheckbox.addEventListener('change', () => {
            this._caseInsensitive = this._caseInsensitiveCheckbox.checked;
            this._loadData(true);
        });
        const checkboxText = document.createElement('span');
        checkboxText.textContent = ' Case insensitive';
        checkboxLabel.appendChild(this._caseInsensitiveCheckbox);
        checkboxLabel.appendChild(checkboxText);
        statusMiddle.appendChild(checkboxLabel);
        // Create regex checkbox
        const regexLabel = document.createElement('label');
        regexLabel.className = 'jp-ParquetViewer-regexLabel';
        this._regexCheckbox = document.createElement('input');
        this._regexCheckbox.type = 'checkbox';
        this._regexCheckbox.className = 'jp-ParquetViewer-regexCheckbox';
        this._regexCheckbox.checked = this._useRegex;
        this._regexCheckbox.addEventListener('change', () => {
            this._useRegex = this._regexCheckbox.checked;
            this._loadData(true);
        });
        const regexText = document.createElement('span');
        regexText.textContent = ' Use regex';
        regexLabel.appendChild(this._regexCheckbox);
        regexLabel.appendChild(regexText);
        statusMiddle.appendChild(regexLabel);
        this._statusRight = document.createElement('div');
        this._statusRight.className = 'jp-ParquetViewer-statusRight';
        this._statusBar.appendChild(this._statusLeft);
        this._statusBar.appendChild(statusMiddle);
        this._statusBar.appendChild(this._statusRight);
        // Append table container and status bar directly to widget node
        this.node.appendChild(this._tableContainer);
        this.node.appendChild(this._statusBar);
        // Set up scroll listener for progressive loading
        this._tableContainer.addEventListener('scroll', () => {
            this._onScroll();
        });
        // Remove context-active class when clicking anywhere or dismissing context menu
        const removeHighlight = () => {
            this._contextMenuOpen = false;
            this._tbody.classList.remove('jp-ParquetViewer-context-menu-open');
            this._tbody.querySelectorAll('tr').forEach(r => {
                r.classList.remove('jp-ParquetViewer-row-context-active');
            });
            // Stop observing when highlight is removed
            if (this._menuObserver) {
                this._menuObserver.disconnect();
                this._menuObserver = null;
            }
        };
        // Store cleanup function for external access
        this._cleanupHighlight = removeHighlight;
        // Initialize
        this._initialize();
    }
    /**
     * Start observing for menu removal when context menu opens
     */
    _startMenuObserver() {
        // Stop any existing observer
        if (this._menuObserver) {
            this._menuObserver.disconnect();
        }
        // Create observer to watch for menu removal from DOM
        this._menuObserver = new MutationObserver((mutations) => {
            for (const mutation of mutations) {
                if (mutation.type === 'childList' && mutation.removedNodes.length > 0) {
                    // Check if any removed node is a Lumino menu
                    for (const node of Array.from(mutation.removedNodes)) {
                        if (node instanceof HTMLElement &&
                            (node.classList.contains('lm-Menu') || node.classList.contains('p-Menu'))) {
                            // Menu was removed, clear highlight
                            if (this._cleanupHighlight) {
                                this._cleanupHighlight();
                            }
                            return;
                        }
                    }
                }
            }
        });
        // Observe document body for child removals
        this._menuObserver.observe(document.body, {
            childList: true,
            subtree: false
        });
    }
    /**
     * Get cleanup function to clear highlight (for external use)
     */
    getCleanupHighlight() {
        return this._cleanupHighlight || (() => { });
    }
    /**
     * Initialize the viewer by loading metadata and initial data
     */
    async _initialize() {
        try {
            await this._loadMetadata();
            await this._loadData(true);
        }
        catch (error) {
            this._showError(`Failed to load file: ${error}`);
        }
    }
    /**
     * Load file metadata (columns, types, row count)
     */
    async _loadMetadata() {
        const response = await (0,_request__WEBPACK_IMPORTED_MODULE_1__.requestAPI)('metadata', {
            method: 'POST',
            body: JSON.stringify({ path: this._filePath })
        });
        this._columns = response.columns;
        this._totalRows = response.totalRows;
        this._unfilteredTotalRows = response.totalRows;
        this._fileSize = response.fileSize || 0;
        this._renderHeaders();
        this._updateStatusBar();
    }
    /**
     * Load data from server
     */
    async _loadData(reset = false) {
        if (this._loading) {
            return;
        }
        this._loading = true;
        this._updateStatusBar('Loading...');
        try {
            if (reset) {
                this._currentOffset = 0;
                this._data = [];
                this._tbody.innerHTML = '';
            }
            const response = await (0,_request__WEBPACK_IMPORTED_MODULE_1__.requestAPI)('data', {
                method: 'POST',
                body: JSON.stringify({
                    path: this._filePath,
                    offset: this._currentOffset,
                    limit: this._limit,
                    filters: this._filters,
                    sortBy: this._sortBy,
                    sortOrder: this._sortOrder,
                    caseInsensitive: this._caseInsensitive,
                    useRegex: this._useRegex
                })
            });
            this._data = this._data.concat(response.data);
            this._hasMore = response.hasMore;
            this._currentOffset += response.data.length;
            if (reset) {
                this._totalRows = response.totalRows;
            }
            this._renderData(response.data);
            this._updateStatusBar();
        }
        catch (error) {
            this._showError(`Failed to load data: ${error}`);
        }
        finally {
            this._loading = false;
        }
    }
    /**
     * Render table headers with filter inputs
     */
    _renderHeaders() {
        this._filterRow.innerHTML = '';
        this._headerRow.innerHTML = '';
        this._columns.forEach(col => {
            // Create filter cell
            const filterCell = document.createElement('th');
            filterCell.className = 'jp-ParquetViewer-filterCell';
            const filterInput = document.createElement('input');
            filterInput.type = 'text';
            filterInput.className = 'jp-ParquetViewer-filterInput';
            filterInput.placeholder = this._getFilterPlaceholder(col.type);
            filterInput.dataset.columnName = col.name;
            filterInput.dataset.columnType = col.type;
            filterInput.addEventListener('keyup', (e) => {
                if (e.key === 'Enter') {
                    this._applyFilter(col.name, filterInput.value, col.type);
                }
            });
            filterCell.appendChild(filterInput);
            this._filterRow.appendChild(filterCell);
            // Create header cell with column name and type
            const headerCell = document.createElement('th');
            headerCell.className = 'jp-ParquetViewer-headerCell';
            headerCell.style.cursor = 'pointer';
            headerCell.dataset.columnName = col.name;
            // Add click handler for sorting
            headerCell.addEventListener('click', () => {
                this._toggleSort(col.name);
            });
            const headerContent = document.createElement('div');
            headerContent.className = 'jp-ParquetViewer-headerContent';
            const nameSpan = document.createElement('div');
            nameSpan.className = 'jp-ParquetViewer-columnName';
            nameSpan.textContent = col.name;
            const typeSpan = document.createElement('div');
            typeSpan.className = 'jp-ParquetViewer-columnType';
            typeSpan.textContent = this._simplifyType(col.type);
            const sortIndicator = document.createElement('span');
            sortIndicator.className = 'jp-ParquetViewer-sortIndicator';
            sortIndicator.textContent = '';
            headerContent.appendChild(nameSpan);
            headerContent.appendChild(typeSpan);
            headerCell.appendChild(headerContent);
            headerCell.appendChild(sortIndicator);
            // Add resize handle
            const resizeHandle = document.createElement('div');
            resizeHandle.className = 'jp-ParquetViewer-resizeHandle';
            resizeHandle.addEventListener('mousedown', (e) => {
                e.preventDefault();
                e.stopPropagation();
                this._startResize(col.name, e.clientX, headerCell);
            });
            // Prevent click events from triggering sort
            resizeHandle.addEventListener('click', (e) => {
                e.preventDefault();
                e.stopPropagation();
            });
            headerCell.appendChild(resizeHandle);
            // Set width - use stored width or default to 200px
            const columnWidth = this._columnWidths.get(col.name) || 200;
            if (!this._columnWidths.has(col.name)) {
                this._columnWidths.set(col.name, columnWidth);
            }
            headerCell.style.width = `${columnWidth}px`;
            filterCell.style.width = `${columnWidth}px`;
            this._headerRow.appendChild(headerCell);
        });
        // Set table width to sum of all column widths
        const totalWidth = Array.from(this._columnWidths.values()).reduce((sum, w) => sum + w, 0);
        this._table.style.width = `${totalWidth}px`;
    }
    /**
     * Render data rows
     */
    _renderData(rows) {
        rows.forEach(row => {
            const tr = document.createElement('tr');
            tr.className = 'jp-ParquetViewer-row';
            this._columns.forEach(col => {
                const td = document.createElement('td');
                td.className = 'jp-ParquetViewer-cell';
                const value = row[col.name];
                td.textContent = value !== null && value !== undefined ? String(value) : '';
                tr.appendChild(td);
            });
            // Remove context-active class when hovering over any row (only if context menu not open)
            tr.addEventListener('mouseenter', () => {
                // Don't clear highlight while context menu is open
                if (!this._contextMenuOpen) {
                    this._tbody.querySelectorAll('tr').forEach(r => {
                        r.classList.remove('jp-ParquetViewer-row-context-active');
                    });
                }
            });
            // Add right-click handler to store row data and maintain hover styling
            tr.addEventListener('contextmenu', (e) => {
                // Mark context menu as open
                this._contextMenuOpen = true;
                // Add class to tbody to disable hover on other rows
                this._tbody.classList.add('jp-ParquetViewer-context-menu-open');
                // Remove context-active class from all rows
                this._tbody.querySelectorAll('tr').forEach(r => {
                    r.classList.remove('jp-ParquetViewer-row-context-active');
                });
                // Add context-active class to keep hover styling visible
                tr.classList.add('jp-ParquetViewer-row-context-active');
                // Store row data for context menu
                this._setLastContextMenuRow(row);
                // Start observing for menu removal
                this._startMenuObserver();
            });
            this._tbody.appendChild(tr);
        });
    }
    /**
     * Start column resize
     */
    _startResize(columnName, startX, headerCell) {
        this._resizing = {
            columnName,
            startX,
            startWidth: headerCell.offsetWidth
        };
        // Add global mouse event listeners
        document.addEventListener('mousemove', this._doResize);
        document.addEventListener('mouseup', this._stopResize);
        // Prevent text selection during resize
        document.body.style.userSelect = 'none';
        document.body.style.cursor = 'col-resize';
    }
    /**
     * Apply filter to a column
     */
    _applyFilter(columnName, value, columnType) {
        if (!value.trim()) {
            // Remove filter if empty
            delete this._filters[columnName];
        }
        else {
            const isNumeric = this._isNumericType(columnType);
            if (isNumeric) {
                // Parse numerical filter with operator
                const match = value.match(/^([><=]+)?\s*(.+)$/);
                if (match) {
                    const operator = match[1] || '=';
                    const numValue = match[2].trim();
                    this._filters[columnName] = {
                        type: 'number',
                        value: numValue,
                        operator: operator
                    };
                }
            }
            else {
                // Text filter
                this._filters[columnName] = {
                    type: 'text',
                    value: value
                };
            }
        }
        // Reload data with filters
        this._loadData(true);
    }
    /**
     * Simplify type names for display
     */
    _simplifyType(type) {
        const lowerType = type.toLowerCase();
        // Date types
        if (lowerType.includes('date32') || lowerType.includes('date64')) {
            return 'date';
        }
        // Timestamp/datetime types
        if (lowerType.includes('timestamp')) {
            return 'datetime';
        }
        // Integer types
        if (lowerType.match(/^u?int(8|16|32|64)$/)) {
            return 'int';
        }
        // Float types
        if (lowerType.match(/^(float|double)(16|32|64)?$/)) {
            return 'float';
        }
        // Decimal types
        if (lowerType.includes('decimal')) {
            return 'decimal';
        }
        // Boolean
        if (lowerType === 'bool') {
            return 'boolean';
        }
        // String types
        if (lowerType === 'string' || lowerType === 'utf8' || lowerType === 'large_string' || lowerType === 'large_utf8') {
            return 'string';
        }
        // Binary types
        if (lowerType === 'binary' || lowerType === 'large_binary') {
            return 'binary';
        }
        // List types
        if (lowerType.startsWith('list')) {
            return 'list';
        }
        // Struct types
        if (lowerType.startsWith('struct')) {
            return 'struct';
        }
        // Default: return as-is
        return type;
    }
    /**
     * Check if column type is numeric
     */
    _isNumericType(type) {
        const numericTypes = ['int', 'float', 'double', 'decimal', 'int8', 'int16', 'int32', 'int64', 'uint8', 'uint16', 'uint32', 'uint64'];
        return numericTypes.some(t => type.toLowerCase().includes(t));
    }
    /**
     * Get filter placeholder based on column type
     */
    _getFilterPlaceholder(type) {
        if (this._isNumericType(type)) {
            return '=, >, <, >=, <=';
        }
        return 'text or regex...';
    }
    /**
     * Handle scroll event for progressive loading
     */
    _onScroll() {
        const container = this._tableContainer;
        const scrollPosition = container.scrollTop + container.clientHeight;
        const scrollHeight = container.scrollHeight;
        // Load more when scrolled to within 200px of bottom
        if (scrollPosition >= scrollHeight - 200 && this._hasMore && !this._loading) {
            this._loadData(false);
        }
    }
    /**
     * Toggle sort on a column
     */
    _toggleSort(columnName) {
        if (this._sortBy === columnName) {
            // Cycle through: asc -> desc -> off
            if (this._sortOrder === 'asc') {
                this._sortOrder = 'desc';
            }
            else if (this._sortOrder === 'desc') {
                // Turn off sorting
                this._sortBy = null;
                this._sortOrder = 'asc';
            }
        }
        else {
            // Sort by new column (ascending)
            this._sortBy = columnName;
            this._sortOrder = 'asc';
        }
        this._updateSortIndicators();
        this._loadData(true);
    }
    /**
     * Update sort indicators in column headers
     */
    _updateSortIndicators() {
        const headers = this._headerRow.querySelectorAll('th');
        headers.forEach(header => {
            const columnName = header.dataset.columnName;
            const indicator = header.querySelector('.jp-ParquetViewer-sortIndicator');
            if (columnName === this._sortBy) {
                indicator.textContent = this._sortOrder === 'asc' ? ' ▲' : ' ▼';
            }
            else {
                indicator.textContent = '';
            }
        });
    }
    /**
     * Clear all filters
     */
    _clearFilters() {
        this._filters = {};
        // Clear filter inputs
        const filterInputs = this._filterRow.querySelectorAll('input');
        filterInputs.forEach(input => {
            input.value = '';
        });
        this._loadData(true);
    }
    /**
     * Format file size to human-readable string
     */
    _formatFileSize(bytes) {
        if (bytes === 0)
            return '0 B';
        const k = 1024;
        const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
        const i = Math.floor(Math.log(bytes) / Math.log(k));
        return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
    }
    /**
     * Update status bar
     */
    _updateStatusBar(message) {
        if (message) {
            this._statusLeft.textContent = '';
            this._statusRight.textContent = message;
        }
        else {
            // Left side: file stats (always show unfiltered total)
            const numColumns = this._columns.length;
            const fileSize = this._formatFileSize(this._fileSize);
            this._statusLeft.textContent = `${numColumns} columns • ${this._unfilteredTotalRows} rows • ${fileSize}`;
            // Right side: showing info and clear filters link
            const filterCount = Object.keys(this._filters).length;
            let rightText = `Showing ${this._data.length} of ${this._totalRows} rows`;
            if (filterCount > 0) {
                rightText += ` (${filterCount} filter${filterCount > 1 ? 's' : ''} active)`;
            }
            this._statusRight.innerHTML = rightText;
            if (filterCount > 0) {
                const clearLink = document.createElement('a');
                clearLink.href = '#';
                clearLink.className = 'jp-ParquetViewer-clearFilters';
                clearLink.textContent = 'Clear filters';
                clearLink.addEventListener('click', (e) => {
                    e.preventDefault();
                    this._clearFilters();
                });
                this._statusRight.appendChild(document.createTextNode(' • '));
                this._statusRight.appendChild(clearLink);
            }
        }
    }
    /**
     * Show error message
     */
    _showError(message) {
        this._tbody.innerHTML = '';
        const tr = document.createElement('tr');
        const td = document.createElement('td');
        td.colSpan = this._columns.length || 1;
        td.className = 'jp-ParquetViewer-error';
        td.textContent = message;
        tr.appendChild(td);
        this._tbody.appendChild(tr);
    }
    /**
     * Dispose of the widget
     */
    dispose() {
        this._tableContainer.removeEventListener('scroll', this._onScroll);
        // Clean up menu observer
        if (this._menuObserver) {
            this._menuObserver.disconnect();
            this._menuObserver = null;
        }
        // Clean up resize event listeners if still active
        if (this._resizing) {
            document.removeEventListener('mousemove', this._doResize);
            document.removeEventListener('mouseup', this._stopResize);
            document.body.style.userSelect = '';
            document.body.style.cursor = '';
        }
        super.dispose();
    }
}


/***/ })

}]);
//# sourceMappingURL=lib_index_js.cbfd3eb0b36ff68b747c.js.map