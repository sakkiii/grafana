import React from 'react';
import { toDataFrame, FieldType } from '@grafana/data';
import { fireEvent, render, screen, getByText } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Props, ConfigFromQueryTransformerEditor } from './ConfigFromQueryTransformerEditor';

beforeEach(() => {
  jest.clearAllMocks();
});

const input = toDataFrame({
  fields: [
    { name: 'Name', type: FieldType.string, values: ['Temperature', 'Pressure'] },
    { name: 'Value', type: FieldType.number, values: [10, 200] },
    { name: 'Unit', type: FieldType.string, values: ['degree', 'pressurebar'] },
    { name: 'Miiin', type: FieldType.number, values: [3, 100] },
    { name: 'max', type: FieldType.string, values: [15, 200] },
  ],
  refId: 'A',
});

const mockOnChange = jest.fn();

const props: Props = {
  input: [input],
  onChange: mockOnChange,
  options: {
    mappings: [],
  },
};

const setup = (testProps?: Partial<Props>) => {
  const editorProps = { ...props, ...testProps };
  return render(<ConfigFromQueryTransformerEditor {...editorProps} />);
};

describe('ConfigFromQueryTransformerEditor', () => {
  it('Should be able to select config frame by refId', async () => {
    setup();

    let select = (await screen.findByText('Config query')).nextSibling!;
    await fireEvent.keyDown(select, { keyCode: 40 });
    await userEvent.click(getByText(select as HTMLElement, 'A'));

    expect(mockOnChange).toHaveBeenCalledWith(
      expect.objectContaining({
        configRefId: 'A',
      })
    );
  });
});
