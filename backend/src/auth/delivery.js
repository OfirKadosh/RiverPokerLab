function deliveryConfig(env = process.env) {
  const email = env.EMAIL_PROVIDER || "disabled",
    sms = env.SMS_PROVIDER || "disabled";
  const manual = env.AUTH_ALLOW_MANUAL_DELIVERY === "true";
  if ([email, sms].includes("manual") && !manual)
    throw Error("Manual verification delivery requires explicit opt-in.");
  const development =
    env.AUTH_ALLOW_DEV_DELIVERY === "true" && env.NODE_ENV !== "production";
  if ([email, sms].includes("development") && !development)
    throw Error("Development verification delivery is disabled.");
  if (
    !["resend", "manual", "development", "disabled"].includes(email) ||
    !["twilio", "manual", "development", "disabled"].includes(sms)
  )
    throw Error("Unsupported verification provider.");
  const channels = [];
  if (
    ["development", "manual"].includes(email) ||
    (email === "resend" && env.RESEND_API_KEY && env.EMAIL_FROM)
  )
    channels.push("email");
  if (
    ["development", "manual"].includes(sms) ||
    (sms === "twilio" &&
      env.TWILIO_ACCOUNT_SID &&
      env.TWILIO_AUTH_TOKEN &&
      env.TWILIO_FROM)
  )
    channels.push("sms");
  return {
    channels,
    manualChannels: ["email", "sms"].filter((channel) => ({ email, sms })[channel] === "manual"),
    development: [email, sms].includes("development"),
    email,
    sms,
  };
}
function createDelivery(env = process.env, fetcher = fetch, logger = console) {
  const config = deliveryConfig(env);
  return {
    config,
    async send({ channel, to, code, userId, username }) {
      if (!config.channels.includes(channel))
        throw Error("Verification delivery is unavailable.");
      if (config[channel] === "manual") {
        logger.info(JSON.stringify({
          event: "manual_account_activation",
          userId, username, channel, expiresInMinutes: 10,
        }));
        return;
      }
      if (config[channel] === "development") {
        logger.info(
          `[LOCAL DEVELOPMENT ONLY] ${channel} verification code: ${code}. Expires in 10 minutes. No message sent.`,
        );
        return;
      }
      let response;
      const text = `Your River Poker Lab verification code is ${code}. It expires in 10 minutes. If you did not request it, ignore this message.`;
      if (channel === "email")
        response = await fetcher("https://api.resend.com/emails", {
          method: "POST",
          headers: {
            Authorization: `Bearer ${env.RESEND_API_KEY}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            from: env.EMAIL_FROM,
            to: [to],
            subject: "Verify your River Poker Lab account",
            text,
          }),
          signal: AbortSignal.timeout(10000),
        });
      else
        response = await fetcher(
          `https://api.twilio.com/2010-04-01/Accounts/${encodeURIComponent(env.TWILIO_ACCOUNT_SID)}/Messages.json`,
          {
            method: "POST",
            headers: {
              Authorization: `Basic ${Buffer.from(`${env.TWILIO_ACCOUNT_SID}:${env.TWILIO_AUTH_TOKEN}`).toString("base64")}`,
              "Content-Type": "application/x-www-form-urlencoded",
            },
            body: new URLSearchParams({
              To: to,
              From: env.TWILIO_FROM,
              Body: text,
            }).toString(),
            signal: AbortSignal.timeout(10000),
          },
        );
      if (!response.ok)
        throw Error("Verification provider rejected the request.");
    },
  };
}
module.exports = { createDelivery, deliveryConfig };
