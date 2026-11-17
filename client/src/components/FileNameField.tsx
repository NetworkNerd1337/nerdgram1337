import { fileNameIssue } from "../lib/fileName";

type FileNameFieldProps = {
  id: string;
  value: string;
  taken?: readonly string[];
  autoFocus?: boolean;
  onChange: (value: string) => void;
};

/** Required file name, with the `.mmd` suffix beside it and a collision hint. */
export function FileNameField({ id, value, taken = [], autoFocus = false, onChange }: FileNameFieldProps) {
  const issue = fileNameIssue(value, taken);
  return (
    <div className="file-name-field">
      <label htmlFor={id}>File name</label>
      <div className="file-name-row">
        <input
          id={id}
          value={value}
          placeholder="Campus core"
          autoFocus={autoFocus}
          aria-required="true"
          required
          onChange={(event) => onChange(event.target.value)}
        />
        <span className="file-name-suffix" aria-hidden="true">
          .mmd
        </span>
      </div>
      {issue.empty ? (
        <p className="file-name-hint" id={`${id}-hint`}>
          Enter a file name. This is the file that is saved.
        </p>
      ) : null}
      {issue.taken ? (
        <p className="file-name-hint" role="status">
          {issue.taken}.mmd is already in this folder.{" "}
          <button type="button" className="btn btn-ghost" onClick={() => onChange(issue.suggestion)}>
            Use {issue.suggestion}
          </button>
        </p>
      ) : null}
    </div>
  );
}
