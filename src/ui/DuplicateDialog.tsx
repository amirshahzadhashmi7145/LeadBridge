import type { DuplicateMatch } from '@/sheets/types';
import { ownershipMessage } from '@/sheets/duplicates';

interface Props {
  match: DuplicateMatch;
  onUpdate: () => void;
  onCreate: () => void;
  onCancel: () => void;
}

export function DuplicateDialog({ match, onUpdate, onCreate, onCancel }: Props) {
  if (!match.sameUser) {
    return (
      <div className="dialog-backdrop">
        <div className="dialog">
          <h2>Lead already captured</h2>
          <p>{ownershipMessage(match)}</p>
          <p className="muted">Source: {match.source || 'Unknown platform'}</p>
          <div className="actions" style={{ position: 'static', padding: '8px 0 0' }}>
            <button className="secondary" onClick={onCancel}>
              Close
            </button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="dialog-backdrop">
      <div className="dialog">
        <h2>This lead is already in the sheet</h2>
        <p>
          You captured this lead{match.capturedAt ? ` on ${new Date(match.capturedAt).toLocaleString()}` : ''}.
          Update the existing row, add another entry, or cancel.
        </p>
        <div className="actions" style={{ position: 'static', padding: '8px 0 0' }}>
          <button className="primary" onClick={onUpdate}>
            Update existing lead
          </button>
          <button className="secondary" onClick={onCreate}>
            Create a new entry
          </button>
          <button className="ghost" onClick={onCancel}>
            Cancel
          </button>
        </div>
      </div>
    </div>
  );
}
