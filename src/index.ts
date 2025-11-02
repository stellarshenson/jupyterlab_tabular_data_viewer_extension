import {
  JupyterFrontEnd,
  JupyterFrontEndPlugin
} from '@jupyterlab/application';

import {
  IDocumentWidget,
  DocumentRegistry,
  ABCWidgetFactory
} from '@jupyterlab/docregistry';

import { ISettingRegistry } from '@jupyterlab/settingregistry';

import { ParquetViewer } from './widget';
import { ParquetDocument } from './document';

/**
 * A widget factory for Parquet files
 */
class ParquetWidgetFactory extends ABCWidgetFactory<
  IDocumentWidget<ParquetViewer>
> {
  private _setLastContextMenuRow: (row: any) => void;
  private _setActiveWidget: (widget: ParquetViewer) => void;

  constructor(
    options: DocumentRegistry.IWidgetFactoryOptions,
    setLastContextMenuRow: (row: any) => void,
    setActiveWidget: (widget: ParquetViewer) => void
  ) {
    super(options);
    this._setLastContextMenuRow = setLastContextMenuRow;
    this._setActiveWidget = setActiveWidget;
  }

  /**
   * Create a new widget given a context
   */
  protected createNewWidget(
    context: DocumentRegistry.Context
  ): IDocumentWidget<ParquetViewer> {
    console.log(`[Parquet Viewer] Creating widget for file: ${context.path}`);
    console.log(`[Parquet Viewer] File type: ${context.contentsModel?.type}, Format: ${context.contentsModel?.format}`);

    const content = new ParquetViewer(context.path, this._setLastContextMenuRow);
    const widget = new ParquetDocument({ content, context });
    widget.title.label = context.path.split('/').pop() || 'Parquet File';

    // Track this as the active widget when context menu is used
    this._setActiveWidget(content);

    return widget;
  }
}

/**
 * Settings interface
 */
interface ISettings {
  enableParquet: boolean;
  enableExcel: boolean;
}

/**
 * Initialization data for the jupyterlab_parquet_viewer_extension extension.
 */
const plugin: JupyterFrontEndPlugin<void> = {
  id: 'jupyterlab_parquet_viewer_extension:plugin',
  description:
    'Jupyterlab extension to allow simple browsing of the parquet files with basic data filtering capabilities',
  autoStart: true,
  requires: [ISettingRegistry],
  activate: async (app: JupyterFrontEnd, settingRegistry: ISettingRegistry) => {
    console.log(
      'JupyterLab extension jupyterlab_parquet_viewer_extension is activated!'
    );

    const { docRegistry, commands, contextMenu } = app;

    // Track last right-clicked row for context menu
    let lastContextMenuRow: any = null;
    let activeWidget: ParquetViewer | null = null;

    // Load settings
    let settings: ISettings = {
      enableParquet: true,
      enableExcel: false
    };

    console.log('[Parquet Viewer] Default settings:', settings);

    try {
      console.log('[Parquet Viewer] Loading settings from registry with id:', plugin.id);
      const pluginSettings = await settingRegistry.load(plugin.id);
      settings = pluginSettings.composite as unknown as ISettings;
      console.log('[Parquet Viewer] Loaded settings:', settings);
      console.log('[Parquet Viewer] Settings detail - enableParquet:', settings.enableParquet, 'enableExcel:', settings.enableExcel);

      // Watch for settings changes
      pluginSettings.changed.connect(() => {
        settings = pluginSettings.composite as unknown as ISettings;
        console.log('[Parquet Viewer] Settings changed:', settings);
      });
    } catch (error) {
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
    const binaryFileTypes: string[] = [];

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
      } catch (e) {
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
      } catch (e) {
        console.warn('[Parquet Viewer] Excel file type already registered', e);
      }
    }

    // Create binary factory for Parquet and Excel files
    if (binaryFileTypes.length > 0) {
      const binaryFactory = new ParquetWidgetFactory(
        {
          name: 'Parquet Viewer (Binary)',
          modelName: 'base64',
          fileTypes: binaryFileTypes,
          defaultFor: binaryFileTypes,
          defaultRendered: binaryFileTypes,
          readOnly: true
        },
        (row: any) => {
          lastContextMenuRow = row;
        },
        (widget: ParquetViewer) => {
          activeWidget = widget;
        }
      );

      docRegistry.addWidgetFactory(binaryFactory);
      console.log(`[Parquet Viewer] Binary factory registered for: ${binaryFileTypes.join(', ')}`);
    } else {
      console.warn('[Parquet Viewer] No file types enabled in settings');
    }
  }
};

export default plugin;
