import Stripe from 'stripe';
import dotenv from 'dotenv';

import MembershipModel from '../models/membership_model.js';
import UserModel from '../models/user_model.js';

dotenv.config();

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);

let base_url = process.env.DEV_FRONTEND_URL;

if (process.env.NODE_ENV === 'production') {
  base_url = process.env.PROD_FRONTEND_URL;
}


export async function createOneTimePaymentSession(req, res) {
  const { credits } = req.body;
  const { firebase_id, email_verified } = req;

  const user = await UserModel.findOne({ firebase_id });
  if (!user) {
    return res.status(404).json({ message: 'User not found' });
  }

  if(!email_verified) {
		return res.status(403).json({ message: 'User is not verified' });
	}

  const total = credits * 0.3 * 100

  const currency = 'usd';

  try {
    const session = await stripe.checkout.sessions.create({
      mode: "payment",
      payment_method_types: ["card"],
      line_items: [
        {
          price_data: {
            currency: currency,
            product_data: {
              name: "Resume Optimization Credits",
            },
            unit_amount: total,
          },
          quantity: 1,
        },
      ],
      success_url: `${base_url}/profile`,
      cancel_url: `${base_url}/`,
      metadata: {
        firebase_id: firebase_id,
        credits: credits
      },
    });

    res.json({ sessionId: session.id });
  } catch (err) {
    console.error('Failed to create payment session:', err);
    res.status(400).json({ error: err.message });
  }
}

export async function createSubscriptionSession(req, res) {
  const { membership } = req.body;
  const { firebase_id, email_verified } = req;

  const user = await UserModel.findOne({ firebase_id });
  if (!user) {
    return res.status(404).json({ message: "User not found" });
  }

  if(!email_verified) {
		return res.status(403).json({ message: 'User is not verified' });
	}

  const membership_details = await MembershipModel.findOne({ name: membership });
  if (!membership_details || !membership_details.stripe_price_id) {
    return res.status(404).json({ message: "Membership or Stripe Price ID not found" });
  }

  try {
    const session = await stripe.checkout.sessions.create({
      mode: "subscription",
      payment_method_types: ["card"],
      line_items: [
        {
          price: membership_details.stripe_price_id,
          quantity: 1,
        },
      ],
      metadata: {
        firebase_id: firebase_id,
        membership: membership,
      },
      success_url: `${base_url}/profile`,
      cancel_url: `${base_url}/`,
    });

    res.json({ sessionId: session.id });
  } catch (err) {
    console.error("Failed to create subscription session:", err);
    res.status(400).json({ error: err.message });
  }
}

export async function cancelSubscription(req, res) {
  const { firebase_id, email_verified } = req;

  const user = await UserModel.findOne({ firebase_id });
  if (!user) {
    return res.status(404).json({ message: "User not found" });
  }

  if(!email_verified) {
		return res.status(403).json({ message: 'User is not verified' });
	}

  try {
    await stripe.subscriptions.update(user.stripe_subscription_id, {
      cancel_at_period_end: true,
    });

    const subscription = await stripe.subscriptions.retrieve(user.stripe_subscription_id);

    console.log(subscription);

    const endDate = new Date(subscription.cancel_at * 1000);

    await UserModel.updateOne(
      { firebase_id },
      {
        $set: {
          subscription: "cancelled",
          subscription_end: endDate
        }
      }
    );
  } catch (err) {
    console.error("Failed to cancel subscription:", err);
    res.status(400).json({ error: err.message });
  }

  res.json({ message: "Subscription cancelled" });
}

async function handleOneTimePayment(session, res) {
  const firebaseId = session.metadata?.firebase_id;
  const credits = session.metadata?.credits;

  const user = await UserModel.findOne({ firebase_id: firebaseId });

  if (!user) {
    console.error('User not found');
    return res.status(404).send('User not found');
  }

  if(!user.verified) {
		return res.status(403).json({ message: 'User is not verified' });
	}

  await UserModel.updateOne(
    { firebase_id: firebaseId },
    {
      $inc: { credits: Number(credits) }
    }
  );

  console.log("Payment intent handled");
}

async function handleSubscription(session, res) {
  const firebaseId = session.metadata.firebase_id;
  const membership = session.metadata.membership;
  const subscriptionId = session.subscription;

  const user = await UserModel.findOne({ firebase_id: firebaseId });

  if (!user) {
    console.error('User not found');
    return res.status(404).send('User not found');
  }

  if(!user.verified) {
		return res.status(403).json({ message: 'User is not verified' });
	}

  const membership_details = await MembershipModel.findOne({ name: membership });
  if (!membership_details) {
    console.error('Membership not found');
    return res.status(404).send('Membership not found');
  }

  await UserModel.updateOne(
    { firebase_id: firebaseId },
    {
      $set: {
        membership: membership_details.name,
        subscription: "active",
        stripe_subscription_id: subscriptionId
      }
    }
  );

  console.log("Checkout session handled");
}

export async function webhook(req, res) {
  console.log("Webhook received");
  const sig = req.headers["stripe-signature"];

  let event;
  try {
    event = stripe.webhooks.constructEvent(
      req.body,
      sig,
      process.env.STRIPE_WEBHOOK_SECRET
    );
  } catch (err) {
    console.error('Failed to construct event:', err);
    return res.status(400).send(`Webhook error: ${err.message}`);
  }

  switch (event.type) {
    case "checkout.session.completed":
      const session = event.data.object;
      switch (session.mode) {
        case "subscription":
          await handleSubscription(session, res);
          break;
        case "payment":
          await handleOneTimePayment(session, res);
          break;
      }
      break;
  }

  res.json({ received: true });
}