<script>
	const example = `import { Resend } from "resend";

const resend = new Resend(process.env.CDFSEND_API_KEY, {
  baseUrl: "${location.origin}",
});

const { data, error } = await resend.emails.send({
  from: "Acme <hello@example.com>",
  to: "you@example.com",
  subject: "Welcome aboard",
  html: "<h1>Hello from cdfsend.</h1>",
  text: "Hello from cdfsend.",
}, { idempotencyKey: "welcome-user-123" });`;
</script>

<div class="section-heading">
	<div>
		<h1>Quick start</h1>
	</div>
</div>
<div class="guide-grid">
	<section class="panel panel-padding">
		<span class="step-number">01</span>
		<h3>Register a domain</h3>
		<p class="muted">
			Add a domain in this organization. It must already be enabled for sending in the Cloudflare
			account hosting cdfsend.
		</p>
	</section>
	<section class="panel panel-padding">
		<span class="step-number">02</span>
		<h3>Create a sending key</h3>
		<p class="muted">
			Choose a domain-scoped sending key for your app. Store it server-side, never in browser code.
		</p>
	</section>
	<section class="panel panel-padding">
		<span class="step-number">03</span>
		<h3>Send with Resend</h3>
		<p class="muted">
			Install <code>resend</code>, set your API key and base URL, and send. Success means Cloudflare
			accepted the message.
		</p>
	</section>
</div>
<section class="code-panel">
	<div class="panel-heading">
		<h3>npm install resend</h3>
		<span>JavaScript / Node.js</span>
	</div>
	<pre><code>{example}</code></pre>
</section>
