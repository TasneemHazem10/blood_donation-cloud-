import { request, setSession } from '../api.js';
import { esc, toast, formValue } from '../ui.js';

const BLOOD_TYPES = ['A+', 'A-', 'B+', 'B-', 'AB+', 'AB-', 'O+', 'O-'];

async function botToken() {
  const key = (window.BDO && window.BDO.turnstileSiteKey) || '';
  if (!key || !window.turnstile) return '';
  try { return await window.turnstile.getResponse(); } catch { return ''; }
}

function loadTurnstile() {
  const key = (window.BDO && window.BDO.turnstileSiteKey) || '';
  if (!key || document.querySelector('script[data-turnstile]')) return;
  const script = document.createElement('script');
  script.src = 'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit';
  script.async = true;
  script.dataset.turnstile = '1';
  script.onload = () => window.turnstile && window.turnstile.render('.cf-turnstile', { sitekey: key });
  document.head.appendChild(script);
}

export function renderLogin(root, ctx) {
  root.innerHTML = `<section class="panel" style="max-width:520px;margin:20px auto">
    <div class="panel-title"><h2>Welcome back</h2><a class="small" href="#/register">New here? Register</a></div>
    <form id="loginForm" class="stack">
      <div class="field"><label for="email">Email</label><input id="email" name="email" type="email" autocomplete="email" required /></div>
      <div class="field"><label for="password">Password</label><input id="password" name="password" type="password" autocomplete="current-password" required /></div>
      <div class="cf-turnstile" data-sitekey="${esc((window.BDO && window.BDO.turnstileSiteKey) || '')}"></div>
      <div id="authError"></div>
      <button class="btn btn-primary" type="submit">Log in</button>
    </form>
  </section>`;
  loadTurnstile();
  root.querySelector('#loginForm').onsubmit = async (event) => {
    event.preventDefault();
    const form = event.currentTarget;
    const button = form.querySelector('button[type=submit]');
    button.disabled = true;
    try {
      const data = await request('donor', 'POST', '/api/auth/login', {
        auth: false,
        body: { email: formValue(form, 'email'), password: formValue(form, 'password'), turnstileToken: await botToken() }
      });
      setSession(data.token, data.user);
      toast(`Welcome back, ${data.user.name}!`, 'success');
      window.dispatchEvent(new Event('bdo:session'));
      ctx.navigate(data.user.role === 'organizer' ? '#/organizer' : '#/profile');
    } catch (error) {
      root.querySelector('#authError').innerHTML = `<div class="alert alert-error">${esc(error.message)}</div>`;
    } finally { button.disabled = false; }
  };
}

export function renderRegister(root, ctx) {
  root.innerHTML = `<section class="panel" style="max-width:760px;margin:20px auto">
    <div class="panel-title"><h2>Create your account</h2><a class="small" href="#/login">Already registered?</a></div>
    <form id="registerForm" class="stack">
      <div class="form-grid">
        <div class="field"><label for="name">Full name</label><input id="name" name="name" required minlength="2" /></div>
        <div class="field"><label for="email">Email</label><input id="email" name="email" type="email" required /></div>
        <div class="field"><label for="password">Password (8+ characters)</label><input id="password" name="password" type="password" minlength="8" required /></div>
        <div class="field"><label for="role">Account type</label><select id="role" name="role">
          <option value="donor">Donor</option><option value="organizer">Organizer</option></select></div>
      </div>
      <div id="donorFields" class="form-grid">
        <div class="field"><label for="bloodType">Blood type</label><select id="bloodType" name="bloodType">
          ${BLOOD_TYPES.map((type) => `<option value="${type}">${type}</option>`).join('')}</select></div>
        <div class="field"><label for="weightKg">Weight (kg)</label><input id="weightKg" name="weightKg" type="number" min="30" max="300" value="60" required /></div>
        <div class="field"><label for="birthYear">Birth year</label><input id="birthYear" name="birthYear" type="number" min="1900" max="${new Date().getFullYear()}" value="2000" required /></div>
        <div class="field"><label for="phone">Phone (optional)</label><input id="phone" name="phone" /></div>
      </div>
      <div id="inviteField" class="field" hidden><label for="inviteCode">Organizer invite code</label><input id="inviteCode" name="inviteCode" /></div>
      <div class="cf-turnstile" data-sitekey="${esc((window.BDO && window.BDO.turnstileSiteKey) || '')}"></div>
      <div id="authError"></div>
      <button class="btn btn-primary" type="submit">Create account</button>
    </form>
  </section>`;
  loadTurnstile();

  const form = root.querySelector('#registerForm');
  form.elements.role.onchange = () => {
    const organizer = form.elements.role.value === 'organizer';
    root.querySelector('#donorFields').hidden = organizer;
    root.querySelector('#inviteField').hidden = !organizer;
  };
  form.onsubmit = async (event) => {
    event.preventDefault();
    const button = form.querySelector('button[type=submit]');
    button.disabled = true;
    const body = {
      name: formValue(form, 'name'), email: formValue(form, 'email'), password: formValue(form, 'password'),
      role: form.elements.role.value,
      turnstileToken: await botToken()
    };
    if (body.role === 'donor') {
      Object.assign(body, {
        bloodType: form.elements.bloodType.value,
        weightKg: Number(formValue(form, 'weightKg')),
        birthYear: Number(formValue(form, 'birthYear')),
        phone: formValue(form, 'phone')
      });
    } else body.inviteCode = formValue(form, 'inviteCode');

    try {
      const data = await request('donor', 'POST', '/api/auth/register', { auth: false, body });
      setSession(data.token, data.user);
      toast('Account created. Welcome to BloodLink!', 'success');
      window.dispatchEvent(new Event('bdo:session'));
      ctx.navigate(data.user.role === 'organizer' ? '#/organizer' : '#/profile');
    } catch (error) {
      root.querySelector('#authError').innerHTML = `<div class="alert alert-error">${esc(error.message)}</div>`;
    } finally { button.disabled = false; }
  };
}
