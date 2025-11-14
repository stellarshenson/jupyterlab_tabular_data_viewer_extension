import { URLExt } from '@jupyterlab/coreutils';

import { ServerConnection } from '@jupyterlab/services';

/**
 * Call the server extension
 *
 * @param endPoint API REST end point for the extension
 * @param init Initial values for the request
 * @returns The response body interpreted as JSON
 */
export async function requestAPI<T>(
  endPoint = '',
  init: RequestInit = {}
): Promise<T> {
  // Make request to Jupyter API
  const settings = ServerConnection.makeSettings();
  const requestUrl = URLExt.join(
    settings.baseUrl,
    'jupyterlab-tabular-data-viewer-extension', // our server extension's API namespace
    endPoint
  );

  let response: Response;
  try {
    response = await ServerConnection.makeRequest(requestUrl, init, settings);
  } catch (error) {
    throw new ServerConnection.NetworkError(error as any);
  }

  let data: any = await response.text();

  if (data.length > 0) {
    try {
      data = JSON.parse(data);
    } catch (error) {
      console.log('Not a JSON response body.', response);
    }
  }

  if (!response.ok) {
    throw new ServerConnection.ResponseError(response, data.message || data);
  }

  return data;
}

/**
 * Column statistics interface
 */
export interface IColumnStats {
  column_name: string;
  data_type: string;
  total_rows: number;
  non_null_count: number;
  non_null_percentage: number;
  null_count: number;
  null_percentage: number;
  unique_count: number;
  unique_percentage: number;
  // Numeric stats
  min_value?: number;
  max_value?: number;
  mean?: number;
  median?: number;
  std_dev?: number;
  outlier_count?: number;
  outlier_percentage?: number;
  outlier_lower_bound?: number;
  outlier_upper_bound?: number;
  // String stats
  most_common_value?: string;
  most_common_count?: number;
  min_length?: number;
  max_length?: number;
  avg_length?: number;
  // Date stats
  earliest_date?: string;
  latest_date?: string;
  date_range_days?: number;
}

/**
 * Fetch column statistics from the backend
 *
 * @param filePath Path to the data file
 * @param columnName Name of column to analyze
 * @returns Column statistics
 */
export async function fetchColumnStats(
  filePath: string,
  columnName: string
): Promise<IColumnStats> {
  return requestAPI<IColumnStats>('column-stats', {
    method: 'POST',
    body: JSON.stringify({
      path: filePath,
      columnName: columnName
    })
  });
}

/**
 * Unique values interface
 */
export interface IUniqueValues {
  values: string[];
  counts: number[];
  limit: number;
  total_count: number;
}

/**
 * Fetch unique values for a column from the backend
 *
 * @param filePath Path to the data file
 * @param columnName Name of column to get unique values for
 * @returns Unique values
 */
export async function fetchUniqueValues(
  filePath: string,
  columnName: string,
  limit: number = 100
): Promise<IUniqueValues> {
  return requestAPI<IUniqueValues>('unique-values', {
    method: 'POST',
    body: JSON.stringify({
      path: filePath,
      columnName: columnName,
      limit: limit
    })
  });
}
