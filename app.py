import os
import json
import time
import psycopg2
import psycopg2.extras
from flask import (Flask, render_template, request, flash,
                   session, jsonify, redirect, url_for, send_from_directory)
from werkzeug.security import generate_password_hash, check_password_hash
from functools import wraps
import requests

# ── Exchange rate cache (process-local, 1-hour TTL) ───────────────────────────
_rates_cache: dict = {}   # { "USD": {"EUR": 0.92, ...}, ... }
_rates_ts:    dict = {}   # { "USD": 1714000000.0, ... }
RATES_TTL = 3600

app = Flask(__name__, template_folder='templates')
app.secret_key = os.environ.get("SECRET_KEY")
EXCHANGE_API_KEY = os.environ.get("EXCHANGE_API_KEY")

# ── Database ──────────────────────────────────────────────────────────────────

def get_db():
    return psycopg2.connect(os.environ["DATABASE_URL"])

def init_db():
    conn = get_db()
    try:
        with conn:
            with conn.cursor() as cur:
                cur.execute("""
                    CREATE TABLE IF NOT EXISTS users (
                        id SERIAL PRIMARY KEY,
                        username TEXT UNIQUE NOT NULL,
                        password_hash TEXT NOT NULL,
                        created_at TIMESTAMP DEFAULT NOW()
                    );
                    CREATE TABLE IF NOT EXISTS user_data (
                        user_id INTEGER REFERENCES users(id) PRIMARY KEY,
                        expenses_data JSONB,
                        subs_data JSONB,
                        updated_at TIMESTAMP DEFAULT NOW()
                    );
                    ALTER TABLE user_data ADD COLUMN IF NOT EXISTS income_data JSONB;
                """)
    finally:
        conn.close()

with app.app_context():
    init_db()

# ── Auth helpers ──────────────────────────────────────────────────────────────

def login_required(f):
    @wraps(f)
    def decorated(*args, **kwargs):
        if 'user_id' not in session:
            return jsonify({"error": "Not logged in"}), 401
        return f(*args, **kwargs)
    return decorated

def _ctx():
    """Return Jinja2 template context with current user info."""
    return {
        "current_user": session.get('username'),
        "current_user_id": session.get('user_id'),
    }

# ── Static CSS ────────────────────────────────────────────────────────────────

@app.route('/styles.css')
def serve_css():
    return send_from_directory('templates', 'styles.css', mimetype='text/css')

# ── Page routes ───────────────────────────────────────────────────────────────

@app.route('/')
def home():
    return render_template('index.html', **_ctx())

@app.route('/login', methods=['GET'])
def login_page():
    if 'user_id' in session:
        return redirect(url_for('home'))
    return render_template('login.html', **_ctx())

@app.route('/expenses')
def expenses():
    return render_template('expenses.html', **_ctx())

@app.route('/subscriptions')
def subscriptions_page():
    return render_template('subscriptions.html', **_ctx())

@app.route('/analytics')
def analytics():
    return render_template('analytics.html', **_ctx())

@app.route('/income')
def income():
    return render_template('income.html', **_ctx())

@app.route('/account')
def account():
    if 'user_id' not in session:
        return redirect(url_for('login_page'))
    return render_template('account.html', **_ctx())

@app.route('/currency', methods=['GET', 'POST'])
def currency():
    if request.method == 'POST':
        currency_i = request.form.get('currency_i', '').upper()
        currency_o = request.form.get('currency_o', '').upper()
        currency_a_raw = request.form.get('currency_a')

        if not currency_a_raw:
            flash('Please enter a valid number for amount.', 'error')
            return render_template('currency.html', currency_i=currency_i,
                                   currency_o=currency_o, currency_a='', **_ctx())
        try:
            currency_a = float(currency_a_raw)
            if currency_a < 0:
                flash('Amount cannot be negative.', 'error')
                return render_template('currency.html', currency_i=currency_i,
                                       currency_o=currency_o, currency_a=currency_a_raw, **_ctx())

            converted_amount = round(convert(currency_i, currency_a, currency_o), 2)
            flash('Currency converted successfully.', 'success')
            return render_template('currency.html', result=True,
                                   converted=converted_amount, currency_i=currency_i,
                                   currency_o=currency_o, currency_a=currency_a_raw, **_ctx())
        except ValueError:
            flash('Please enter a valid number for amount.', 'error')
            return render_template('currency.html', currency_i=currency_i,
                                   currency_o=currency_o, currency_a=currency_a_raw, **_ctx())
        except KeyError:
            flash('Invalid currency code.', 'error')
            return render_template('currency.html', currency_i=currency_i,
                                   currency_o=currency_o, currency_a=currency_a_raw, **_ctx())
        except requests.exceptions.RequestException:
            flash("Please check your 'from currency' input. If it is correct, "
                  "there has been a problem connecting to the exchange rate API.", 'error')
            return render_template('currency.html', currency_i=currency_i,
                                   currency_o=currency_o, currency_a=currency_a_raw, **_ctx())

    return render_template('currency.html', currency_i='', currency_o='', currency_a='', **_ctx())

@app.route('/interest', methods=['GET', 'POST'])
def interest():
    if request.method == 'POST':
        interest_type = request.form.get('type')
        try:
            principal = float(request.form.get('principal'))
            rate = float(request.form.get('rate'))
            time = float(request.form.get('time'))
            if principal < 0 or rate < 0 or time < 0:
                flash('No negative values allowed.', 'error')
                return render_template('interest.html', **_ctx())

            if interest_type == 'simple':
                si = simple_interest(principal, rate, time)
                amt = si + principal
                flash('Simple interest calculated successfully.', 'success')
                result = {'description': 'Simple Interest Result', 'interest': si, 'total': amt}
                return render_template('interest.html', result=result, **_ctx())

            elif interest_type == 'compound':
                periods = float(request.form.get('periods', 1))
                if periods <= 0:
                    flash('Compounding periods must be positive.', 'error')
                    return render_template('interest.html', **_ctx())
                amt = compound_interest(principal, rate, time, periods)
                interest_amt = amt - principal
                flash('Compound interest calculated successfully.', 'success')
                result = {'description': 'Compound Interest Result',
                          'interest': interest_amt, 'total': amt}
                return render_template('interest.html', result=result, **_ctx())

            elif interest_type == 'continuous':
                import math
                amt = round(principal * math.exp((rate / 100) * time), 2)
                interest_amt = round(amt - principal, 2)
                flash('Continuous interest calculated successfully.', 'success')
                result = {'description': 'Continuous Compounding Result',
                          'interest': interest_amt, 'total': amt}
                return render_template('interest.html', result=result, **_ctx())

            else:
                flash('Invalid interest type selected.', 'error')
                return render_template('interest.html', **_ctx())

        except ValueError:
            flash('Please enter valid numeric inputs.', 'error')
            return render_template('interest.html', **_ctx())

    return render_template('interest.html', **_ctx())

@app.route('/tax', methods=['GET', 'POST'])
def tax():
    if request.method == 'POST':
        income = request.form.get('income', '').strip()
        status = request.form.get('status', '')
        display_status = status
        if status == 'head of household':
            status = 'hoh'
            display_status = 'Head of Household'
        elif status == 'single':
            display_status = 'Single'
        elif status == 'married':
            display_status = 'Married'

        try:
            income_float = float(income)
            if income_float < 0:
                flash('Income cannot be negative.', 'error')
                return render_template('tax.html', income=income, status=status, **_ctx())

            tax_amount = fetch_tax(income, status)
            flash('Tax calculated successfully.', 'success')
            result = {'income': income_float, 'status': display_status, 'tax': tax_amount}
            return render_template('tax.html', result=result, income=income, status=status, **_ctx())

        except ValueError:
            flash('Please enter a valid number for income.', 'error')
            return render_template('tax.html', income=income, status=status, **_ctx())
        except requests.exceptions.JSONDecodeError:
            flash('Invalid response from tax API.', 'error')
            return render_template('tax.html', income=income, status=status, **_ctx())
        except requests.exceptions.RequestException:
            flash('Problem connecting to tax API.', 'error')
            return render_template('tax.html', income=income, status=status, **_ctx())
        except Exception:
            flash('Please enter valid input.', 'error')
            return render_template('tax.html', income=income, status=status, **_ctx())

    return render_template('tax.html', **_ctx())

# ── Auth API ──────────────────────────────────────────────────────────────────

@app.route('/auth/register', methods=['POST'])
def register():
    data = request.get_json()
    username = (data.get('username') or '').strip()
    password = data.get('password') or ''
    if not username or not password:
        return jsonify({"error": "Username and password required"}), 400
    if len(username) < 3:
        return jsonify({"error": "Username must be at least 3 characters"}), 400
    if len(password) < 6:
        return jsonify({"error": "Password must be at least 6 characters"}), 400
    conn = get_db()
    try:
        with conn:
            with conn.cursor() as cur:
                cur.execute(
                    "INSERT INTO users (username, password_hash) VALUES (%s, %s) RETURNING id",
                    (username, generate_password_hash(password))
                )
                user_id = cur.fetchone()[0]
                cur.execute("INSERT INTO user_data (user_id) VALUES (%s)", (user_id,))
        session['user_id'] = user_id
        session['username'] = username
        return jsonify({"ok": True, "username": username})
    except psycopg2.errors.UniqueViolation:
        return jsonify({"error": "Username already taken"}), 409
    finally:
        conn.close()

@app.route('/auth/login', methods=['POST'])
def auth_login():
    data = request.get_json()
    username = (data.get('username') or '').strip()
    password = data.get('password') or ''
    conn = get_db()
    try:
        with conn.cursor() as cur:
            cur.execute("SELECT id, password_hash FROM users WHERE username=%s", (username,))
            row = cur.fetchone()
        if not row or not check_password_hash(row[1], password):
            return jsonify({"error": "Invalid username or password"}), 401
        session['user_id'] = row[0]
        session['username'] = username
        return jsonify({"ok": True, "username": username})
    finally:
        conn.close()

@app.route('/auth/logout', methods=['POST'])
def auth_logout():
    session.clear()
    return jsonify({"ok": True})

@app.route('/auth/me')
def auth_me():
    if 'user_id' in session:
        return jsonify({"username": session['username'], "id": session['user_id']})
    return jsonify({"user": None}), 200

@app.route('/auth/delete_account', methods=['POST'])
@login_required
def delete_account():
    data = request.get_json(silent=True) or {}
    password = data.get('password') or ''
    if not password:
        return jsonify({"error": "Password is required"}), 400
    user_id = session['user_id']
    conn = get_db()
    try:
        with conn.cursor() as cur:
            cur.execute("SELECT password_hash FROM users WHERE id=%s", (user_id,))
            row = cur.fetchone()
        if not row or not check_password_hash(row[0], password):
            return jsonify({"error": "Incorrect password"}), 401
        with conn:
            with conn.cursor() as cur:
                cur.execute("DELETE FROM user_data WHERE user_id=%s", (user_id,))
                cur.execute("DELETE FROM users WHERE id=%s", (user_id,))
        session.clear()
        return jsonify({"ok": True})
    finally:
        conn.close()

# ── Data API ──────────────────────────────────────────────────────────────────

@app.route('/api/save/expenses', methods=['POST'])
@login_required
def save_expenses():
    data = request.get_json(silent=True)
    if not isinstance(data, dict):
        return jsonify({"error": "Invalid data format"}), 400
    if 'rows' not in data:
        return jsonify({"error": "Missing required field: rows"}), 400
    conn = get_db()
    try:
        with conn:
            with conn.cursor() as cur:
                cur.execute("""
                    INSERT INTO user_data (user_id, expenses_data, updated_at)
                    VALUES (%s, %s, NOW())
                    ON CONFLICT (user_id) DO UPDATE
                    SET expenses_data = EXCLUDED.expenses_data, updated_at = NOW()
                """, (session['user_id'], json.dumps(data)))
        return jsonify({"ok": True})
    finally:
        conn.close()

@app.route('/api/load/expenses')
@login_required
def load_expenses():
    conn = get_db()
    try:
        with conn.cursor() as cur:
            cur.execute("SELECT expenses_data FROM user_data WHERE user_id=%s",
                        (session['user_id'],))
            row = cur.fetchone()
        if row and row[0]:
            return jsonify(row[0])
        return jsonify(None)
    finally:
        conn.close()

@app.route('/api/save/subs', methods=['POST'])
@login_required
def save_subs():
    data = request.get_json(silent=True)
    if not isinstance(data, dict):
        return jsonify({"error": "Invalid data format"}), 400
    if 'rows' not in data:
        return jsonify({"error": "Missing required field: rows"}), 400
    conn = get_db()
    try:
        with conn:
            with conn.cursor() as cur:
                cur.execute("""
                    INSERT INTO user_data (user_id, subs_data, updated_at)
                    VALUES (%s, %s, NOW())
                    ON CONFLICT (user_id) DO UPDATE
                    SET subs_data = EXCLUDED.subs_data, updated_at = NOW()
                """, (session['user_id'], json.dumps(data)))
        return jsonify({"ok": True})
    finally:
        conn.close()

@app.route('/api/load/subs')
@login_required
def load_subs():
    conn = get_db()
    try:
        with conn.cursor() as cur:
            cur.execute("SELECT subs_data FROM user_data WHERE user_id=%s",
                        (session['user_id'],))
            row = cur.fetchone()
        if row and row[0]:
            return jsonify(row[0])
        return jsonify(None)
    finally:
        conn.close()

@app.route('/api/save/income', methods=['POST'])
@login_required
def save_income():
    data = request.get_json(silent=True)
    if not isinstance(data, dict):
        return jsonify({"error": "Invalid data format"}), 400
    if 'rows' not in data:
        return jsonify({"error": "Missing required field: rows"}), 400
    conn = get_db()
    try:
        with conn:
            with conn.cursor() as cur:
                cur.execute("""
                    INSERT INTO user_data (user_id, income_data, updated_at)
                    VALUES (%s, %s, NOW())
                    ON CONFLICT (user_id) DO UPDATE
                    SET income_data = EXCLUDED.income_data, updated_at = NOW()
                """, (session['user_id'], json.dumps(data)))
        return jsonify({"ok": True})
    finally:
        conn.close()

@app.route('/api/load/income')
@login_required
def load_income():
    conn = get_db()
    try:
        with conn.cursor() as cur:
            cur.execute("SELECT income_data FROM user_data WHERE user_id=%s",
                        (session['user_id'],))
            row = cur.fetchone()
        if row and row[0]:
            return jsonify(row[0])
        return jsonify(None)
    finally:
        conn.close()

# ── Exchange rate proxy ───────────────────────────────────────────────────────

@app.route('/api/exchange')
def api_exchange():
    from_currency = request.args.get('from', 'USD').upper()
    to_currency = request.args.get('to', '').upper()
    try:
        rates = fetch(from_currency)
        if to_currency:
            rate = rates.get(to_currency)
            if rate is None:
                return jsonify({"error": f"Unknown currency: {to_currency}"}), 400
            return jsonify({"rate": rate, "from": from_currency, "to": to_currency})
        return jsonify({"rates": rates, "from": from_currency})
    except requests.exceptions.RequestException as e:
        return jsonify({"error": str(e)}), 502

# ── Math helpers ──────────────────────────────────────────────────────────────

def simple_interest(principal, rate, time):
    return round(principal * (rate / 100) * time, 2)

def compound_interest(principal, rate, time, periods):
    return round(principal * ((1 + (rate / 100) / periods) ** (time * periods)), 2)

def fetch_tax(income, status):
    url = f"https://api.taxapi.net/income/{status}/{income}"
    response = requests.get(url)
    response.raise_for_status()
    return round(response.json(), 2)

def fetch(currency_i: str) -> dict:
    now = time.time()
    if currency_i in _rates_cache and now - _rates_ts.get(currency_i, 0) < RATES_TTL:
        return _rates_cache[currency_i]
    url = f"https://v6.exchangerate-api.com/v6/{EXCHANGE_API_KEY}/latest/{currency_i}"
    response = requests.get(url, timeout=8)
    response.raise_for_status()
    rates = response.json()["conversion_rates"]
    _rates_cache[currency_i] = rates
    _rates_ts[currency_i] = now
    return rates

def convert(currency_i, currency_a, currency_o):
    return currency_a * fetch(currency_i)[currency_o]

# ── Entry point ───────────────────────────────────────────────────────────────

if __name__ == '__main__':
    app.run(host='0.0.0.0', port=int(os.environ.get('PORT', 5000)))
