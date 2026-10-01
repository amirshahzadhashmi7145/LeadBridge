import type { DuplicateMatch } from '@/sheets/types';
import { ownershipMessage } from '@/sheets/duplicates';

interface Props {
  match: DuplicateMatch;
  onCancel: () => void;
}

export function DuplicateDialog({ match, onCancel }: Props) {
  return (
    <div className="dialog-backdrop">
      <div className="dialog">
        <h2>This lead already exists</h2>
        <p>{ownershipMessage(match)}</p>
        <div className="actions" style={{ position: 'static', padding: '8px 0 0' }}>
          <button className="primary" onClick={onCancel}>
            Close
          </button>
        </div>
      </div>
    </div>
  );
}
