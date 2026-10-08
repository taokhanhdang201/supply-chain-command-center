import type { ImportIssue } from '../../../shared/types';

export interface ImportIssueTableProps {
  issues: readonly ImportIssue[];
  totalErrors?: number;
  caption: string;
}

/** The import problem table (line, column, message), with a note when the server capped the list. */
export function ImportIssueTable({ issues, totalErrors, caption }: ImportIssueTableProps) {
  const truncated = totalErrors !== undefined && totalErrors > issues.length;
  return (
    <>
      <div className="table-scroll">
        <table className="data-table">
          <caption className="visually-hidden">{caption}</caption>
          <thead>
            <tr>
              <th scope="col" className="data-table__header--right">Line</th>
              <th scope="col">Column</th>
              <th scope="col">Problem</th>
            </tr>
          </thead>
          <tbody>
            {issues.map((issue, i) => (
              <tr key={i}>
                <td className="data-table__cell--right">{issue.line === null ? 'File' : issue.line}</td>
                <td>{issue.column ?? '—'}</td>
                <td className="data-table__cell--wrap">{issue.message}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {truncated && <p>Showing first 500 of {totalErrors} problems.</p>}
    </>
  );
}
