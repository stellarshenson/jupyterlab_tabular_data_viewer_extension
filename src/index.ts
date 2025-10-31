import {
  JupyterFrontEnd,
  JupyterFrontEndPlugin
} from '@jupyterlab/application';

import { requestAPI } from './request';

/**
 * Initialization data for the jupyterlab_basic_parquet_viewer_extension extension.
 */
const plugin: JupyterFrontEndPlugin<void> = {
  id: 'jupyterlab_basic_parquet_viewer_extension:plugin',
  description: 'Jupyterlab extension to allow simple browsing of the parquet files with basic data filtering capabilities',
  autoStart: true,
  activate: (app: JupyterFrontEnd) => {
    console.log('JupyterLab extension jupyterlab_basic_parquet_viewer_extension is activated!');

    requestAPI<any>('hello')
      .then(data => {
        console.log(data);
      })
      .catch(reason => {
        console.error(
          `The jupyterlab_basic_parquet_viewer_extension server extension appears to be missing.\n${reason}`
        );
      });
  }
};

export default plugin;
