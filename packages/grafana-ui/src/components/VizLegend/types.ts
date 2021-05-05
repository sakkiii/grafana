import { DataFrameFieldIndex, DisplayValue } from '@grafana/data';
import React from 'react';
import { LegendDisplayMode, LegendPlacement } from './models.gen';

export interface VizLegendBaseProps<T> {
  placement: LegendPlacement;
  className?: string;
  items: Array<VizLegendItem<T>>;
  itemRenderer?: (item: VizLegendItem<T>, index: number) => JSX.Element;
  onLabelClick?: (item: VizLegendItem<T>, event: React.MouseEvent<HTMLElement>) => void;
  onLabelMouseEnter?: (item: VizLegendItem, event: React.MouseEvent<HTMLElement>) => void;
  onLabelMouseOut?: (item: VizLegendItem, event: React.MouseEvent<HTMLElement>) => void;
}

export interface VizLegendTableProps<T> extends VizLegendBaseProps<T> {
  sortBy?: string;
  sortDesc?: boolean;
  onToggleSort?: (sortBy: string) => void;
}

export interface LegendProps<T = any> extends VizLegendBaseProps<T>, VizLegendTableProps<T> {
  displayMode: LegendDisplayMode;
}

export interface VizLegendItem<T = any> {
  getItemKey?: () => string;
  label: string;
  color: string;
  yAxis: number;
  disabled?: boolean;
  // displayValues?: DisplayValue[];
  getDisplayValues?: () => DisplayValue[];
  fieldIndex?: DataFrameFieldIndex;
  data?: T;
}
