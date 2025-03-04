import {Task} from '~/business-logic/model/tasks/task';
import {cloneDeep, isEmpty, sortBy} from 'lodash-es';
import {SelectableListItem} from '@common/shared/ui-components/data/selectable-list/selectable-list.model';
import {Config, PlotData} from 'plotly.js';
import {ExtData, ExtFrame, ExtLayout} from '../shared/single-graph/plotly-graph-base';
import {MetricsPlotEvent} from '../../business-logic/model/events/models';
import {KeyValue} from '@angular/common';

export interface ExtMetricsPlotEvent extends MetricsPlotEvent {
  variants?: Array<string>;
}

export interface IMultiplot {
  [key: string]: { // i.e ROC
    [key: number]: { // Iteration number
      [key: string]: { // experimentId
        name: string;
        plots: ExtFrame[];
      };
    };
  };
}

export interface GroupedList {
  [metric: string]: { [variant: string]: { [experimentId: string]: PlotData } };
}

export const mergeTasks = (tableTask, task) => {
  task.project = tableTask.project;
  task.user = tableTask.user;
  task.task = tableTask.task;
  return task;
};

export const _mergeVariants = (base: Array<any>, variant) => base.slice().concat(variant);

export const _mergePlotsData = (base: any, toMerge: any) =>
  JSON.stringify({...base, data: _mergeVariants(base.data, toMerge.data)});

export const getModelDesignKey = (modelDes): string => {
  const modelStr = typeof modelDes == 'string';
  if (!modelDes || modelStr) {
    return undefined;
  } else {
    const desKeys = Object.keys(modelDes);
    const firstNonEmptyKey = desKeys.find(key => !!modelDes[key]);
    return firstNonEmptyKey ? firstNonEmptyKey : desKeys[0];
  }
};

export const getModelDesign = (modelDesc: Task['execution']['model_desc']): { key: string; value: any } => {
  const key = getModelDesignKey(modelDesc);
  return {key, value: key ? modelDesc[key] : modelDesc};
};

export const prepareGraph = (data: ExtData[], layout: Partial<ExtLayout>, config: Partial<Config>, graph: Partial<ExtMetricsPlotEvent>): Partial<ExtFrame> =>
  ({
    data,
    layout,
    config,
    iter: graph.iter,
    metric: graph.metric,
    task: graph.task,
    timestamp: graph.timestamp,
    type: graph.type as unknown as string,
    variant: graph.variant,
    variants: graph.variants,
    worker: graph['worker'],
  });

export const tryParseJson = (plotString: string): { data: any; layout: any; config?: any } => {
  let parsed: { data: any; layout: any; config?: any };
  try {
    parsed = JSON.parse(plotString);
  } catch (e) {
    parsed = {data: [], layout: {title: 'Unknown data'}};
  }
  return parsed;
};

export const convertPlot = (graph: MetricsPlotEvent, experimentId?: string): { plot: Partial<ExtFrame>; hadError: boolean } => {
  if (!graph?.plot_str) {
    return null;
  }
  const json = tryParseJson(graph.plot_str);
  let hadError;
  if (json.data.length === 0 && json.layout.title === 'Unknown data') {
    hadError = true;
  }
  json.data.task = json.data?.task || experimentId;
  return {plot: prepareGraph(json.data, json.layout, json.config, graph), hadError};
};

export const convertPlots = ({plots, id}: { plots: { [title: string]: MetricsPlotEvent[] }; id: string }): { graphs: { [title: string]: ExtFrame[] }; parsingError } => {
  let parsingError: boolean;
  return {
    graphs: Object.entries(plots).reduce((acc, [key, graphs]) => {
      acc[key] = graphs?.map(graph => {
        const {plot, hadError} = convertPlot(graph, id);
        parsingError = parsingError || hadError;
        return plot;
      });
      return acc;
    }, {}),
    parsingError
  };
};

export const convertScalar = (chartData, title?: string): Partial<ExtFrame> => {
  if (!chartData || isEmpty(chartData)) {
    return null;
  }
  return prepareGraph(chartData, {type: 'scalar', title, xaxis: {title: 'Iterations'}}, {}, {metric: title});
};

export const convertScalars = (scalars: GroupedList, experimentId: string): { [key: string]: ExtFrame[] } =>
  Object.entries(scalars).reduce((acc, graphGroup) => {
    const key = graphGroup[0];
    const graph = graphGroup[1];

    const chartData = Object.entries(graph).sort((a, b) => a[0] > b[0] ? 1 : -1)
      .map(([, data]: [string, any]) => ({
        task: experimentId,
        ...data,
        type: 'scatter'
      }));

    const yValues = chartData?.map((trace: ExtData) => (trace.y as number[])).flat() ?? [0];
    const maxY = Math.max(...yValues);
    const tickformat = maxY >= 1e9 || (maxY < 1e-5 && maxY > 0) ? '.1e' : undefined;
    acc[key] = [prepareGraph(
      chartData,
      {type: 'scalar', title: key, xaxis: {title: 'Iterations'}, yaxis: {tickformat}},
      {},
      {metric: key, type: 'scalar', variants: Object.keys(graph)}
    )];
    return acc;
  }, {});

export const groupIterations = (plots: MetricsPlotEvent[]): { [title: string]: ExtMetricsPlotEvent[] } => {
  if (!plots.length) {
    return {};
  }
  let previousPlotIsMergable = true;
  const sortedPlots = sortBy(plots, 'iter');
  return sortedPlots
    .reduce((groupedPlots, plot) => {
      const metric = plot.metric;
      groupedPlots[metric] = cloneDeep(groupedPlots[metric]) || [];
      const index = groupedPlots[metric].findIndex((existingGraph) => plot.iter === existingGraph.iter);
      const plotParsed = tryParseJson(plot.plot_str);
      if (index > -1 && plotParsed.data && plotParsed.data[0] && ['scatter', 'bar'].includes(plotParsed.data[0]?.type) && previousPlotIsMergable) {
        const basePlotParsed = tryParseJson(groupedPlots[metric][index].plot_str);
        groupedPlots[metric][index].plot_str = _mergePlotsData(basePlotParsed, plotParsed);
        groupedPlots[metric][index].variants.push(plot.variant);
      } else {
        groupedPlots[metric].push({...plot, variants: [plot.variant]});
      }
      previousPlotIsMergable = index > -1 || (index === -1 && ['scatter', 'bar'].includes(plotParsed.data[0]?.type));
      return groupedPlots;
    }, {});
};

export const prepareScalarList = (metricsScalar): GroupedList =>
  Object.keys(metricsScalar || []).reduce((acc, curr) => {
    acc[curr] = {};
    return acc;
  }, {});

export const sortMetricsList = (list: string[]) =>
  list ? sortBy(list, item => item.replace(':', '~').toLowerCase()) : list;

export const preparePlotsList = (groupedPlots: Map<string, any[]>): Array<SelectableListItem> => {
  const list = groupedPlots ? Object.keys(groupedPlots) : [];
  const sortedList = sortMetricsList(list);
  return sortedList.map((item) => ({name: item, value: item}));
};


export const sortByField = (arr: any[], field: string) =>
  sortBy(arr, item => item[field].replace(':', '~').toLowerCase());

export const compareByFieldFunc = (field) =>
  (a: KeyValue<string, any>, b: KeyValue<string, any>) =>
    a[field].replace(':', '~').toLowerCase() >
    b[field].replace(':', '~').toLowerCase() ? 1 : -1;

export const mergeMultiMetrics = (metrics): { [key: string]: ExtFrame[] } => {
  const graphsMap = {};
  Object.keys(metrics).forEach(metric => {
    Object.keys(metrics[metric]).forEach(variant => {
      const chartData = Object.entries(metrics[metric][variant])
        .map(([task, data]: [string, any]) => ({...data, type: 'scatter', task}));
      graphsMap[metric + variant] = [prepareGraph(chartData, {
        type: 'multiScalar',
        title: metric + ' / ' + variant
      }, {}, {metric, variant})];
    });
  });
  return graphsMap;
};

export const mergeMultiMetricsGroupedVariant = (metrics): { [key: string]: ExtFrame[] } => {
  const graphsMap = {};
  Object.keys(metrics).forEach(metric => {
    const chartData = [];
    Object.keys(metrics[metric]).forEach(variant => {
      const multipleExperiments = Object.keys(metrics[metric][variant]).length > 1;
      chartData.push(Object.entries(metrics[metric][variant])
        .map(([taskId, data]: [string, any]) => ({
          ...data,
          type: 'scatter',
          task: taskId,
          name: multipleExperiments ? `${variant} - ${data.name}` : variant
        }))
      );
    });
    graphsMap[metric] = [prepareGraph((chartData as any).flat(), {type: 'multiScalar', title: metric}, {}, {metric})];
  });
  return graphsMap;
};

export const convertMultiPlots = (plots): { [key: string]: ExtFrame[] } =>
  Object.entries(plots).reduce((acc, graphGroup) => {
    const key = graphGroup[0];
    const graphs = graphGroup[1] as Array<any>;
    acc[key] = Object.values(graphs).map(
      graph => prepareGraph(graph.data, graph.layout, graph.config, {...graph, task: graph.task})
    );
    return acc;
  }, {});

export const multiplotsAddChartToGroup = (charts, parsed, metric, experiment, experimentId, variant, iteration, isMultipleVar: boolean) => {
  const allowedMergedTypes = ['scatter', 'scattergl', 'bar', 'scatter3d'];
  let fullName: string;
  const metricVariant = `${metric} - ${variant}`; //isMultipleVar ? `${metric} - ${variant}` : metric;
  if (parsed.layout && parsed.layout.images) {
    if (!charts[metricVariant]) {
      charts[metricVariant] = {};
    }
    const index = Object.keys(charts[metricVariant]).length;
    charts[metricVariant][index] = parsed;
    charts[metricVariant][index].layout.title = `${experiment} (iteration ${iteration})`;
    charts[metricVariant][index].task = experimentId;
    charts[metricVariant][index].metric = metric;
    charts[metricVariant][index].variant = variant;
  }

  // // In case no name set to plot, we invent, so we can split accordingly
  // parsed.data.forEach((varPlot, i) => varPlot.name = varPlot.name || i.toString());

  const isVariantsSplited = (new Set<string>(parsed.data.map(varPlot => varPlot.name))).size > 1;

  for (let i = 0; i < parsed.data.length; i++) {
    let isMultipleTasks = false;
    const variantPlot = parsed.data.slice()[i];
    if (!variantPlot) {
      continue;
    }
    const metricName = metricVariant;
    if (!charts[metricName]) {
      charts[metricName] = {};
    }
    isVariantsSplited && delete variantPlot.legendgroup;
    if ((!variantPlot.type || allowedMergedTypes.includes(variantPlot.type))) {
      if (variantPlot.name) {
        fullName = `${metricVariant} - ${variantPlot.name}`;
      } else {
        fullName = `${metricVariant}`;
      }
      if (isVariantsSplited) {
        variantPlot.seriesName = variantPlot.name;
      }
      variantPlot.name = `${experiment} (iteration ${iteration})`;
      variantPlot.colorKey = experiment;
      variantPlot.task = experimentId;
    } else if (variantPlot.type === 'table') {
      fullName = `${metricVariant} - ${experiment}`;
      variantPlot.task = experimentId;
    } else {
      fullName = `${metricVariant} - ${experiment}`;
      variantPlot.seriesName = variantPlot.name;
      variantPlot.name = experiment;
      variantPlot.colorKey = experiment;
      variantPlot.task = experimentId;
    }
    if (!charts[metricName][fullName]) {
      charts[metricName][fullName] = Object.assign({}, parsed);
      charts[metricName][fullName].data = [variantPlot];
    } else {
      charts[metricName][fullName].data = _mergeVariants(charts[metricName][fullName].data.slice(), variantPlot);
      isMultipleTasks = true;
    }
    charts[metricName][fullName].layout = Object.assign({}, {...charts[metricName][fullName].layout});
    charts[metricName][fullName].layout.title = isMultipleTasks ? variantPlot.seriesName ?? '' : `${experiment} (iteration ${iteration})`;
    charts[metricName][fullName].layout.name = charts[metricName][fullName].layout.name ? `${charts[metricName][fullName].layout.name} - ${experiment}` : fullName;
    charts[metricName][fullName].layout.barmode = isMultipleTasks ? 'group' : 'stack';
    charts[metricName][fullName].layout.showlegend = isMultipleTasks ? true : charts[metricName][fullName].layout.showlegend;
    charts[metricName][fullName].metric = metric;
    charts[metricName][fullName].variant = variant;
    charts[metricName][fullName].task = charts[metricName][fullName].task ?? experimentId;
  }
  return charts;
};

export const seperateMultiplotsVariants = (mixedPlot: IMultiplot, isMultipleVarients): { charts: any; parsingError: boolean } => {
  let charts = {};
  let parsingError: boolean;
  const values = Object.values(mixedPlot);
  if (!values || values.length === 0) {
    return {charts: mixedPlot, parsingError: false};
  }
  for (const variant of values) {
    const duplicateNamesObject = Object.values(variant).reduce((acc, experiment) => {
      const experimentName = Object.values(experiment)[0].name;
      acc[experimentName] = acc[experimentName] !== undefined;
      return acc;
    }, {} as { [name: string]: boolean });

    Object.entries(variant).map(experiment => {
      const experimentId = experiment[0];
      const shortExpId = experimentId.substr(0, 6);
      const experimentData = experiment[1];

      const iterationKey = Object.keys(experimentData)[0];
      const iteration = (experimentData[iterationKey] as any);
      const experimentName = duplicateNamesObject[iteration.name] ? iteration.name + '.' + shortExpId : iteration.name;
      const plot = iteration.plots[0];
      const parsed = tryParseJson(plot.plot_str);
      if (parsed.data.length === 0 && parsed.layout.title === 'Unknown data') {
        parsingError = true;
      }
      charts = multiplotsAddChartToGroup(charts, parsed, plot.metric, experimentName, experimentId, plot.variant, iterationKey, isMultipleVarients);
    });
  }

  return {charts, parsingError};
};

export const prepareMultiPlots = (multiPlots: any): { merged: any; parsingError: boolean } => {
  let hadParsingError = false;
  if (!multiPlots) {
    return {merged: multiPlots, parsingError: false};
  }
  const merged = Object.entries(multiPlots).reduce((acc, graph) => {
    if (!graph[1]) {
      return acc;
    }
    const isMultipleVarients = Object.keys(graph[1]).length > 1;
    const {charts, parsingError} = seperateMultiplotsVariants(graph[1] as IMultiplot, isMultipleVarients);
    const graphsPerVariant = charts;
    hadParsingError = hadParsingError || parsingError;
    return {...acc, ...graphsPerVariant};
  }, {});
  return {merged, parsingError: hadParsingError};
};

export const _testWhite = (x) => {
  const white = new RegExp(/^[\s\-_]$/);
  return white.test(x.charAt(0));
};

export const wordWrap = (str, maxWidth) => {

  if (str.length <= maxWidth) {
    return str;
  }
  const newLineStr = '<br>';
  let done = false;
  let found;
  let res = '';
  do {
    found = false;
    // Inserts new line at first whitespace of the line
    for (let i = maxWidth - 1; i >= 0; i--) {
      if (i > 0 && _testWhite(str.charAt(i))) {
        res = res + [str.slice(0, i), newLineStr].join('');
        str = str.slice(i + 1 || 1);
        found = true;
        break;
      }
    }
    // Inserts new line at maxWidth position, the word is too long to wrap
    if (!found) {
      res += [str.slice(0, maxWidth), newLineStr].join('');
      str = str.slice(maxWidth);
    }

    if (str.length < maxWidth) {
      done = true;
    }
  } while (!done);

  return res + str;
};

export const stripHtml = (s) => s.replace(/<[^>]*>?/gm, '');

export const timeInWords = (milliseconds: number, granularityLevel = 3) => {
  let remaining = Math.floor(milliseconds / 1000);
  if (remaining <= 0) {
    return '0';
  }
  const output = [];
  const timesConst = [12 * 30 * 24 * 60 * 60, 30 * 24 * 60 * 60, 24 * 60 * 60, 60 * 60, 60, 1];
  const timeStringPlural = ['Years', 'Months', 'Days', 'Hours', 'Minutes', 'Seconds'];
  const timeStringSingle = ['Year', 'Month', 'Day', 'Hour', 'Minute', 'Second'];
  for (let i = 0; i < timesConst.length; i++) {
    const unitCount = Math.floor(remaining / timesConst[i]);
    if (unitCount === 0) {
      continue;
    }
    remaining %= timesConst[i];
    const unitString = unitCount > 1 ? `${unitCount} ${timeStringPlural[i]}` : `${unitCount} ${timeStringSingle[i]}`;
    output.push(unitString);
    if (output.length >= granularityLevel) {
      break;
    }
  }
  return output.join(' ');
};

