
const API = "http://localhost:8080";

async function signup() {
  const name  = document.getElementById('fullName').value.trim();
  const email = document.getElementById('email').value.trim();
  const pass  = document.getElementById('spass').value;

  const res = await fetch(`${API}/api/auth/signup`, {
    method: 'POST',
    headers: {'Content-Type':'application/json'},
    body: JSON.stringify({ name, email, password: pass })
  });
  if (!res.ok) {
    const t = await res.text();
    throw new Error(`Signup failed: ${res.status} ${t}`);
  }
  const data = await res.json();
  localStorage.setItem('token', data.token);
  alert('✅ Account created successfully!');
}

async function login() {
  const email = document.getElementById('lemail').value.trim();
  const pass  = document.getElementById('lpass').value;
  const res = await fetch(`${API}/api/auth/login`, {
    method: 'POST',
    headers: {'Content-Type':'application/json'},
    body: JSON.stringify({ email, password: pass })
  });
  if (!res.ok) {
    const t = await res.text();
    throw new Error(`Login failed: ${res.status} ${t}`);
  }
  const data = await res.json();
  localStorage.setItem('token', data.token);
  alert('✅ Logged in successfully!');
}

document.getElementById('signupForm').addEventListener('submit', async (e)=>{
  e.preventDefault();
  try { await signup(); } catch(e){ alert(e.message); }
});

document.getElementById('loginForm').addEventListener('submit', async (e)=>{
  e.preventDefault();
  try { await login(); } catch(e){ alert(e.message); }
});
