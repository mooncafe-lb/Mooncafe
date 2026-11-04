import { h, clear, t, call, toast, errorText, fields, sheet, confirmDialog, state, has } from './core.js';
import { eventText } from './orders.js';

const when = (v) => { if (!v) return t('never'); const d = new Date(v); return Number.isNaN(d.getTime()) ? String(v) : d.toLocaleString(state.lang === 'ar' ? 'ar-LB-u-nu-latn' : 'en-GB', { hour: '2-digit', minute: '2-digit', day: '2-digit', month: '2-digit' }); };
const money = (n) => Number(n).toLocaleString('en-US');
const statusText = (s) => t('order_status')[s] || s;

// Staff tab: who works on what (dashboard) and user accounts.
export function renderStaff(container) {
  const dash = h('div'); const users = h('div');
  async function load() {
    try {
      const d = await call('/staff'); const u = await call('/users');
      clear(dash, h('div', { class: 'notice info' }, h('b', null, `${t('waiting_orders')}: ${d.waiting_orders}`)),
        d.staff.map((s) => card(s)));
      clear(users, h('div', { class: 'row' }, h('h3', null, t('tab_staff')), has('users.manage_staff') || has('users.manage_all') ? h('button', { class: 'btn small', type: 'button', onClick: () => userForm(null) }, `+ ${t('add_user')}`) : null),
        u.users.map((x) => userRow(x)));
    } catch (e) { toast(errorText(e), true); }
  }

  const card = (s) => h('section', { class: `box staff-card${s.is_active ? '' : ' off'}`, dataset: { staff: String(s.id) } },
    h('div', { class: 'row' }, h('div', null, h('b', null, s.name), h('span', { class: 'badge' }, t('roles')[s.role]), !s.is_active ? h('span', { class: 'badge warn' }, t('inactive')) : null),
      h('button', { class: 'btn small ghost', type: 'button', onClick: () => history(s) }, t('details'))),
    h('div', { class: 'stats' }, h('span', null, `${t('active_orders')}: `, h('b', null, String(s.active_orders))), h('span', null, `${t('handled_orders')}: `, h('b', null, String(s.handled_orders))), h('span', null, `${t('last_activity')}: `, h('b', null, when(s.last_activity_at)))),
    s.current_orders.length ? h('div', { class: 'chips' }, s.current_orders.map((o) => h('span', { class: `badge st-${o.status}` }, `${o.code} · ${statusText(o.status)}`))) : null);

  async function history(s) {
    let data;
    try { data = await call(`/staff/${s.id}/history`); } catch (e) { toast(errorText(e), true); return; }
    sheet(data.user.name, (body) => body.appendChild(h('div', null,
      h('h3', null, t('past_orders')), data.orders.length ? data.orders.map((o) => h('div', { class: 'list-row' }, h('div', { class: 'grow' }, h('b', null, o.public_code), h('small', { class: 'hint' }, ` ${when(o.created_at)}`)), h('span', { class: `badge st-${o.status}` }, statusText(o.status)), h('b', null, money(o.total_lbp)))) : h('p', { class: 'hint' }, t('empty')),
      h('h3', null, t('recent_activity')), h('ol', { class: 'log' }, data.activity.map((a) => h('li', { class: 'log-row' }, h('time', null, when(a.created_at)), h('span', null, ` — ${a.public_code}: ${eventText({ event: a.event, status: a.status, target_name: a.target_name, actor_name: data.user.name, changed_by: s.id })}`)))))));
  }

  const userRow = (u) => h('div', { class: 'list-row', dataset: { user: String(u.id) } },
    h('div', { class: 'grow' }, h('b', null, u.name), h('small', { class: 'hint' }, `${u.username ? `@${u.username}` : u.email} · ${t('roles')[u.role]} · ${u.is_active ? t('active') : t('inactive')}`)),
    h('button', { class: 'btn small ghost', type: 'button', onClick: () => userForm(u) }, t('edit')));

  function userForm(u) {
    const superAdmin = has('users.manage_all');
    sheet(u ? t('edit_user') : t('add_user'), (body, close) => {
      const f = {
        full_name: fields.text(t('full_name'), u && u.full_name, { max: 80 }), username: fields.text(t('username'), u && u.username, { max: 32, dir: 'ltr' }),
        email: fields.text(t('email_optional'), u && u.email, { max: 254, dir: 'ltr' }),
        role: fields.select(t('role'), u ? u.role : 'staff', (superAdmin ? ['super_admin', 'manager', 'staff'] : ['staff']).map((r) => ({ value: r, label: t('roles')[r] }))),
        password: fields.text(u ? t('new_password_optional') : t('password'), '', { dir: 'ltr' }), active: fields.bool(t('active'), u ? u.is_active : true),
      };
      f.password.el.children[1].setAttribute('type', 'password'); f.password.el.children[1].setAttribute('autocomplete', 'new-password');
      const msg = h('div', { class: 'err' });
      const save = async () => {
        const payload = { full_name: f.full_name.get(), username: f.username.get(), email: f.email.get(), role: f.role.get(), is_active: f.active.get() };
        if (!u) payload.password = f.password.get(); else if (f.password.get()) payload.password = f.password.get();
        if (!superAdmin) delete payload.role;
        try { await call(u ? `/users/${u.id}` : '/users', { method: u ? 'PUT' : 'POST', body: payload }); toast(t('saved')); close(); await load(); } catch (e) { msg.textContent = errorText(e); }
      };
      const del = async () => {
        if (!confirmDialog(t('yes_delete'))) return;
        try { await call(`/users/${u.id}`, { method: 'DELETE' }); toast(t('deleted')); close(); await load(); } catch (e) { msg.textContent = errorText(e); }
      };
      body.appendChild(h('div', null, f.full_name.el, f.username.el, f.email.el, superAdmin || !u ? f.role.el : null, f.password.el, f.active.el, msg,
        h('div', { class: 'row' }, h('button', { class: 'btn', type: 'button', dataset: { act: 'save-user' }, onClick: save }, t('save')),
          u && superAdmin && u.id !== state.admin.id ? h('button', { class: 'btn ghost', type: 'button', dataset: { act: 'delete-user' }, onClick: del }, t('delete')) : null)));
    });
  }

  clear(container, h('h2', null, t('tab_staff')), dash, users);
  load();
}
