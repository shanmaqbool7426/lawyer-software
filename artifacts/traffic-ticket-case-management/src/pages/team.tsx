import { useMemo, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import {
  AlertCircle, Check, Copy, KeyRound, Loader2, ShieldCheck, UserMinus, UserPlus, Users,
} from 'lucide-react';
import {
  getListTeamQueryKey,
  useCreateTeamMember,
  useDeleteTeamMember,
  useGetMe,
  useListTeam,
  useResetTeamMemberPassword,
  useUpdateTeamMember,
} from '@workspace/api-client-react';
import type { TeamMember } from '@workspace/api-client-react';

// The owner grants sidebar modules one by one; nothing else is configurable,
// which keeps this screen to a single job.

const initials = (name: string) =>
  name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase() ?? '')
    .join('') || '?';

const lastSeenLabel = (value?: string | null) => {
  if (!value) return 'Never signed in';
  const when = new Date(value);
  if (Number.isNaN(when.getTime())) return 'Never signed in';
  const minutes = Math.round((Date.now() - when.getTime()) / 60000);
  if (minutes < 2) return 'Active now';
  if (minutes < 60) return `Seen ${minutes} min ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `Seen ${hours} h ago`;
  const days = Math.round(hours / 24);
  return days === 1 ? 'Seen yesterday' : `Seen ${days} days ago`;
};

function errorText(err: unknown, fallback: string): string {
  const data = (err as { data?: { error?: unknown } } | null)?.data;
  if (data && typeof data.error === 'string' && data.error.trim()) return data.error;
  return err instanceof Error && err.message ? err.message : fallback;
}

async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    return false;
  }
}

function ModuleChecks({
  modules,
  selected,
  onToggle,
  disabled,
}: {
  modules: { key: string; label: string }[];
  selected: string[];
  onToggle: (key: string) => void;
  disabled?: boolean;
}) {
  return (
    <div className="team-checks" data-testid="team-module-checks">
      {modules.map((module) => {
        const on = selected.includes(module.key);
        return (
          <label key={module.key} className={`team-check${on ? ' on' : ''}${disabled ? ' off' : ''}`}>
            <input
              type="checkbox"
              checked={on}
              disabled={disabled}
              onChange={() => onToggle(module.key)}
              data-testid={`check-module-${module.key}`}
            />
            <span className="team-check-box">{on && <Check size={11} />}</span>
            <span>{module.label}</span>
          </label>
        );
      })}
    </div>
  );
}

export function TeamPage() {
  const queryClient = useQueryClient();
  const me = useGetMe();
  const allowed = !!me.data?.canManageTeam;
  const team = useListTeam({ query: { queryKey: getListTeamQueryKey(), enabled: allowed } });

  const createMember = useCreateTeamMember();
  const updateMember = useUpdateTeamMember();
  const deleteMember = useDeleteTeamMember();
  const resetPassword = useResetTeamMemberPassword();

  const modules = me.data?.modules ?? [];
  const members = team.data?.members ?? [];

  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [picked, setPicked] = useState<string[]>(['overview', 'cases', 'clients']);
  const [formError, setFormError] = useState<string | null>(null);
  const [issued, setIssued] = useState<{ name: string; email: string; password: string } | null>(null);
  const [copied, setCopied] = useState(false);

  const [editingId, setEditingId] = useState<string | null>(null);
  const [draft, setDraft] = useState<string[]>([]);
  const [rowError, setRowError] = useState<string | null>(null);

  const moduleLabel = useMemo(() => {
    const map = new Map<string, string>();
    for (const module of modules) map.set(module.key, module.label);
    return map;
  }, [modules]);

  const refresh = () => queryClient.invalidateQueries({ queryKey: getListTeamQueryKey() });

  const toggle = (list: string[], key: string) =>
    list.includes(key) ? list.filter((entry) => entry !== key) : [...list, key];

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setFormError(null);
    if (!name.trim()) return setFormError('Enter the person’s name.');
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())) return setFormError('Enter a valid email address.');
    try {
      const result = await createMember.mutateAsync({
        data: { name: name.trim(), email: email.trim(), permissions: picked },
      });
      setIssued({
        name: result.member.name,
        email: result.member.email ?? email.trim(),
        password: result.password ?? '',
      });
      setCopied(false);
      setName('');
      setEmail('');
      setPicked(['overview', 'cases', 'clients']);
      refresh();
    } catch (err) {
      setFormError(errorText(err, 'Could not create the account.'));
    }
  }

  function startEdit(member: TeamMember) {
    setRowError(null);
    setEditingId(member.id);
    setDraft([...member.permissions]);
  }

  async function savePermissions(member: TeamMember) {
    setRowError(null);
    try {
      await updateMember.mutateAsync({ id: member.id, data: { permissions: draft } });
      setEditingId(null);
      refresh();
    } catch (err) {
      setRowError(errorText(err, 'Could not save the permissions.'));
    }
  }

  async function toggleStatus(member: TeamMember) {
    setRowError(null);
    try {
      await updateMember.mutateAsync({
        id: member.id,
        data: { status: member.status === 'active' ? 'disabled' : 'active' },
      });
      refresh();
    } catch (err) {
      setRowError(errorText(err, 'Could not change access.'));
    }
  }

  async function issuePassword(member: TeamMember) {
    setRowError(null);
    if (!window.confirm(`Give ${member.name} a new password? Their current password stops working immediately.`)) return;
    try {
      const result = await resetPassword.mutateAsync({ id: member.id });
      setIssued({ name: member.name, email: member.email ?? '', password: result.password });
      setCopied(false);
    } catch (err) {
      setRowError(errorText(err, 'Could not reset the password.'));
    }
  }

  async function removeMember(member: TeamMember) {
    setRowError(null);
    if (!window.confirm(`Remove ${member.name} from the workspace? They lose access immediately.`)) return;
    try {
      await deleteMember.mutateAsync({ id: member.id });
      refresh();
    } catch (err) {
      setRowError(errorText(err, 'Could not remove this person.'));
    }
  }

  if (!allowed) {
    return (
      <>
        <div className="eyebrow" style={{ marginBottom: 16 }}>Account / Team</div>
        <div className="card" style={{ padding: 26 }}>
          <div className="team-blocked"><ShieldCheck size={20} /><strong>Only the workspace owner can manage the team.</strong></div>
          <p className="page-copy">Ask the owner of this workspace to add people or change what they can open.</p>
        </div>
      </>
    );
  }

  return (
    <>
      <div className="section-head" style={{ alignItems: 'flex-start', marginBottom: 25 }}>
        <div>
          <div className="eyebrow">Account / Team</div>
          <h1 className="page-title">Team</h1>
          <p className="page-copy">
            Create a login for an employee, then tick the sidebar modules they should see. Anything you leave unticked is hidden for them and refused by the server.
          </p>
        </div>
        <div className="button-row" style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          <span className="pill pill-active" data-testid="text-team-count">
            <Users size={12} style={{ marginRight: 5 }} />{members.length} {members.length === 1 ? 'person' : 'people'}
          </span>
        </div>
      </div>

      {issued && (
        <div className="team-issued" data-testid="team-issued-password">
          <div className="team-issued-head"><KeyRound size={15} /> Login ready for {issued.name}</div>
          <div className="team-issued-grid">
            <div>
              <div className="team-issued-label">Email</div>
              <div className="team-issued-value mono">{issued.email}</div>
            </div>
            <div>
              <div className="team-issued-label">Temporary password</div>
              <div className="team-issued-value mono">{issued.password || 'Existing login — use their current password'}</div>
            </div>
          </div>
          <div className="team-issued-foot">
            <span>
              {issued.password
                ? 'Give this to them once. It is shown only now, and they can keep using it to sign in.'
                : 'That email already had a login, so it was linked to this workspace instead of creating a new one.'}
            </span>
            <div style={{ display: 'flex', gap: 8 }}>
              {issued.password && (
                <button
                  className="button button-ghost"
                  data-testid="button-copy-password"
                  onClick={async () => setCopied(await copyText(`Email: ${issued.email}\nPassword: ${issued.password}`))}
                >
                  <Copy size={14} /> {copied ? 'Copied' : 'Copy'}
                </button>
              )}
              <button className="button button-ghost" onClick={() => setIssued(null)}>Done</button>
            </div>
          </div>
        </div>
      )}

      <div className="team-grid">
        <div className="card team-list" data-testid="team-list">
          {team.isLoading && <div style={{ padding: 20 }}><Loader2 className="animate-spin" size={16} /></div>}
          {rowError && <div className="team-error" style={{ margin: 14 }}><AlertCircle size={13} /> {rowError}</div>}
          {!team.isLoading && members.length === 0 && (
            <div style={{ padding: 22 }} className="muted">No team yet. Add the first employee on the right.</div>
          )}
          {members.map((member) => (
            <div key={member.id} className={`team-row${member.status === 'disabled' ? ' is-off' : ''}`} data-testid={`team-member-${member.id}`}>
              <div className="team-avatar">{initials(member.name)}</div>
              <div className="team-main">
                <div className="team-name">
                  {member.name}
                  {member.role === 'owner' && <span className="pill pill-closed">Owner</span>}
                  {member.status === 'disabled' && <span className="pill pill-void">Turned off</span>}
                </div>
                <div className="team-email">{member.email || 'No email on file'}</div>
                <div className="team-tags">
                  {member.role === 'owner' ? (
                    <span className="team-tag team-tag-all"><ShieldCheck size={10} /> All modules</span>
                  ) : member.permissions.length === 0 ? (
                    <span className="team-tag team-tag-none">No modules yet</span>
                  ) : (
                    member.permissions.map((key) => (
                      <span className="team-tag" key={key}>{moduleLabel.get(key) ?? key}</span>
                    ))
                  )}
                </div>
              </div>
              <div className="team-actions">
                <div className="team-seen">{lastSeenLabel(member.lastSeenAt)}</div>
                {member.role !== 'owner' && (
                  <div className="team-buttons">
                    <button
                      className="button button-ghost"
                      data-testid={`button-edit-${member.id}`}
                      onClick={() => (editingId === member.id ? setEditingId(null) : startEdit(member))}
                    >
                      {editingId === member.id ? 'Close' : 'Edit access'}
                    </button>
                    <button
                      className="button button-ghost"
                      title="Give a new password"
                      data-testid={`button-password-${member.id}`}
                      onClick={() => issuePassword(member)}
                    >
                      <KeyRound size={13} />
                    </button>
                    <button className="button button-ghost" onClick={() => toggleStatus(member)}>
                      {member.status === 'active' ? 'Turn off' : 'Turn on'}
                    </button>
                    <button
                      className="button button-danger"
                      data-testid={`button-remove-${member.id}`}
                      onClick={() => removeMember(member)}
                    >
                      <UserMinus size={13} />
                    </button>
                  </div>
                )}
              </div>
              {editingId === member.id && (
                <div className="team-editor" data-testid={`editor-${member.id}`}>
                  <div className="team-editor-title">Sidebar modules for {member.name}</div>
                  <ModuleChecks
                    modules={modules}
                    selected={draft}
                    onToggle={(key) => setDraft((current) => toggle(current, key))}
                  />
                  <div className="team-editor-actions">
                    <button className="button button-ghost" onClick={() => setDraft(modules.map((m) => m.key))}>All</button>
                    <button className="button button-ghost" onClick={() => setDraft([])}>None</button>
                    <button className="button button-accent" data-testid={`button-save-${member.id}`} onClick={() => savePermissions(member)} disabled={updateMember.isPending}>
                      {updateMember.isPending ? <Loader2 className="animate-spin" size={14} /> : <Check size={14} />} Save
                    </button>
                  </div>
                </div>
              )}
            </div>
          ))}
        </div>

        <form className="card team-form" onSubmit={submit} data-testid="team-form">
          <div className="team-form-head"><UserPlus size={16} /> Add an employee</div>
          <p className="team-form-copy">They sign in on this same page with the email and password you create here.</p>

          <div className="form-field">
            <label className="form-label" htmlFor="team-name">Full name</label>
            <input
              id="team-name"
              className="field"
              value={name}
              onChange={(event) => setName(event.target.value)}
              placeholder="Jordan Blake"
              data-testid="input-team-name"
            />
          </div>
          <div className="form-field">
            <label className="form-label" htmlFor="team-email">Email</label>
            <input
              id="team-email"
              className="field"
              type="email"
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              placeholder="jordan@yourfirm.ca"
              data-testid="input-team-email"
            />
          </div>

          <div className="team-form-label">Sidebar modules</div>
          <ModuleChecks
            modules={modules}
            selected={picked}
            onToggle={(key) => setPicked((current) => toggle(current, key))}
          />
          <div className="team-editor-actions" style={{ marginTop: 10 }}>
            <button type="button" className="button button-ghost" onClick={() => setPicked(modules.map((m) => m.key))}>All</button>
            <button type="button" className="button button-ghost" onClick={() => setPicked([])}>None</button>
          </div>

          {formError && <div className="team-error"><AlertCircle size={13} /> {formError}</div>}

          <button className="button button-accent" type="submit" disabled={createMember.isPending} data-testid="button-create-employee" style={{ marginTop: 14, width: '100%' }}>
            {createMember.isPending ? <Loader2 className="animate-spin" size={15} /> : <UserPlus size={15} />} Create employee
          </button>
          <p className="team-form-hint">
            The owner always keeps every module. Team management itself is never shared.
          </p>
        </form>
      </div>
    </>
  );
}
