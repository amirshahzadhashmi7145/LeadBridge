import type { FieldMeta, FieldStatus } from '@/schema/lead';

interface Props {
  field: FieldMeta;
  onChange: (key: string, value: string) => void;
}

const STATUS_LABEL: Record<FieldStatus, string> = {
  found: 'Found',
  missing: 'Not found',
  edited: 'Edited',
};

export function FieldRow({ field, onChange }: Props) {
  return (
    <div className="field">
      <div className="field-head">
        <label htmlFor={field.key}>{field.label}</label>
        <span className={`chip ${field.status}`}>{STATUS_LABEL[field.status]}</span>
      </div>
      {field.multiline ? (
        <textarea
          id={field.key}
          value={field.value}
          placeholder={field.status === 'missing' ? 'Not found on this page' : ''}
          onChange={(event) => onChange(field.key, event.target.value)}
        />
      ) : (
        <input
          id={field.key}
          value={field.value}
          placeholder={field.status === 'missing' ? 'Not found on this page' : ''}
          onChange={(event) => onChange(field.key, event.target.value)}
        />
      )}
    </div>
  );
}
