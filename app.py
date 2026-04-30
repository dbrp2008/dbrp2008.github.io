from flask import Flask, render_template, request, flash
import requests

app = Flask(__name__)
app.secret_key = "ALL-HAIL-THE-SECRET-KEY"
EXCHANGE_API_KEY = "081a97e88979627d1194f7ee"

@app.route("/", methods=["GET", "POST"])
def home():
    return render_template("index.html")

@app.route("/interest", methods=["GET", "POST"])
def interest():
    if request.method == "POST":
        interest_type = request.form.get("type")
        try:
            principal = float(request.form.get("principal"))
            rate = float(request.form.get("rate"))
            time = float(request.form.get("time"))
            if principal < 0 or rate < 0 or time < 0:
                flash("No negative values allowed.", "error")
                return render_template("interest.html")

            if interest_type == "simple":
                si = simple_interest(principal, rate, time)
                amt = si + principal
                flash("Simple interest calculated successfully.", "success")
                result = {
                    "description": "Simple Interest Result",
                    "interest": si,
                    "total": amt
                }
                return render_template("interest.html", result=result)

            elif interest_type == "compound":
                periods = float(request.form.get("periods", 1))
                if periods < 0:
                    flash("No negative values allowed for periods.", "error")
                    return render_template("interest.html")
                amt = compound_interest(principal, rate, time, periods)
                interest = amt - principal
                flash("Compound interest calculated successfully.", "success")
                result = {
                    "description": "Compound Interest Result",
                    "interest": interest,
                    "total": amt
                }
                return render_template("interest.html", result=result)

            else:
                flash("Invalid interest type selected.", "error")
                return render_template("interest.html")

        except ValueError:
            flash("Please enter valid numeric inputs.", "error")
            return render_template("interest.html")

    return render_template("interest.html")

@app.route("/tax", methods=["GET", "POST"])
def tax():
    if request.method == "POST":
        income = request.form.get("income", "").strip()
        status = request.form.get("status", "")
        display_status = status
        if status == "head of household":
            status = "hoh"
            display_status = "Head of Household"
        elif status == "single":
            display_status = "Single"
        elif status == "married":
            display_status = "Married"
        else:
            display_status = status

        try:
            income_float = float(income)
            if income_float < 0:
                flash("Income cannot be negative.", "error")
                return render_template("tax.html", income=income, status=status)

            tax_amount = fetch_tax(income, status)
            flash("Tax calculated successfully.", "success")
            result = {
                "income": income_float,
                "status": display_status,
                "tax": tax_amount
            }
            return render_template("tax.html", result=result, income=income, status=status)

        except ValueError:
            flash("Please enter a valid number for income.", "error")
            return render_template("tax.html", income=income, status=status)
        except requests.exceptions.JSONDecodeError:
            flash("Invalid response from tax API.", "error")
            return render_template("tax.html", income=income, status=status)
        except requests.exceptions.RequestException:
            flash("Problem connecting to tax API.", "error")
            return render_template("tax.html", income=income, status=status)
        except Exception:
            flash("Please enter valid input.", "error")
            return render_template("tax.html", income=income, status=status)

    return render_template("tax.html")


@app.route("/expenses")
def expenses():
    return render_template("expenses.html")

@app.route("/subscriptions")
def subscriptions():
    return render_template("subscriptions.html")

@app.route("/api/exchange")
def api_exchange():
    from_currency = request.args.get("from", "USD").upper()
    to_currency   = request.args.get("to", "").upper()
    try:
        rates = fetch(from_currency)
        if to_currency:
            rate = rates.get(to_currency)
            if rate is None:
                return {"error": f"Unknown currency: {to_currency}"}, 400
            return {"rate": rate, "from": from_currency, "to": to_currency}
        return {"rates": rates, "from": from_currency}
    except requests.exceptions.RequestException as e:
        return {"error": str(e)}, 502

@app.route("/currency", methods=["GET", "POST"])
def currency():
    if request.method == "POST":
        currency_i = request.form.get("currency_i", "").upper()
        currency_o = request.form.get("currency_o", "").upper()
        currency_a_raw = request.form.get("currency_a")

        if not currency_a_raw:
            flash("Please enter a valid number for amount.", "error")
            return render_template("currency.html", currency_i=currency_i, currency_o=currency_o, currency_a="")

        try:
            currency_a = float(currency_a_raw)
            if currency_a < 0:
                flash("Amount cannot be negative.", "error")
                return render_template("currency.html", currency_i=currency_i, currency_o=currency_o, currency_a=currency_a_raw)

            converted_amount = round(convert(currency_i, currency_a, currency_o), 2)
            flash("Currency converted successfully.", "success")
            return render_template(
                "currency.html",
                result=True,
                converted=converted_amount,
                currency_i=currency_i,
                currency_o=currency_o,
                currency_a=currency_a_raw
            )
        except ValueError:
            flash("Please enter a valid number for amount.", "error")
            return render_template("currency.html", currency_i=currency_i, currency_o=currency_o, currency_a=currency_a_raw)
        except KeyError:
            flash("Invalid currency code.", "error")
            return render_template("currency.html", currency_i=currency_i, currency_o=currency_o, currency_a=currency_a_raw)
        except requests.exceptions.RequestException:
            flash("Please check your 'from currency' input. If it is correct, there has been a problem connecting to exchange rate API.", "error")
            return render_template("currency.html", currency_i=currency_i, currency_o=currency_o, currency_a=currency_a_raw)

    return render_template("currency.html", currency_i="", currency_o="", currency_a="")

def simple_interest(principal, rate, time):
    r = rate / 100
    amt = principal * r * time
    return round(amt, 2)

def compound_interest(principal, rate, time, periods):
    r = rate / 100
    amt = principal * ((1 + r / periods) ** (time * periods))
    return round(amt, 2)

def fetch_tax(income, status):
    url = f"https://api.taxapi.net/income/{status}/{income}"
    response = requests.get(url)
    response.raise_for_status()
    data = response.json()
    return round(data, 2)

def fetch(currency_i):
    url = f"https://v6.exchangerate-api.com/v6/{EXCHANGE_API_KEY}/latest/{currency_i}"
    response = requests.get(url)
    response.raise_for_status()
    data = response.json()
    return data["conversion_rates"]

def convert(currency_i, currency_a, currency_o):
    rates = fetch(currency_i)
    return currency_a * rates[currency_o]

if __name__ == "__main__":
    app.run(debug=True)
