const stripe = require('stripe')('sk_test_51JMcVJGgQs3V8TmTQomhD2360p11zDysecvqRMPCAdkAevd21dq0YbVPNHf62cFeBqcbg7oC8FNLwZ1DWQm9mUWP002UzClIWZ');
const express = require('express');
const app = express();
const admin = require('firebase-admin')
const functions = require('firebase-functions');
// Initialize Firebase
const serviceAccount = require('../firebasefile.json')

admin.initializeApp({
  credential: admin.credential.cert(serviceAccount),
})

const db = admin.firestore()
// Remove ALL body-parser middleware
// Add this middleware to verify raw body presence
app.use((req:any, res:any, next:any) => {
  if (!req.rawBody) {
    console.error('Missing rawBody in Firebase Function');
    return res.status(400).send('Raw body required');
  }
  next();
});

// const handleSubscriptionEvent = async (subscription:any, eventType:any) => {
//   const customerId = subscription.customer;
//   const status = subscription.status; // active, past_due, canceled, etc.
//   // Initialize updateData with fields that are always present
//   const updateData:any = {
//     subscriptionStatus: status,
//     eventType:eventType,
//     updatedBy: 'firebase function',
//     subscriptionUpdatedAt: new Date().toLocaleString('en-US', {
//       day: '2-digit',
//       month: 'short',
//       year: 'numeric',
//       hour: '2-digit',
//       minute: '2-digit',
//       second: '2-digit',
//       hour12: false,
//     }),
//   };

//   // Check if subscription items are present
//   if (subscription.items && subscription.items.data && subscription.items.data.length > 0) {
//     const firstItem = subscription.items.data[0];
//     console.log('first item',firstItem)
//     if (firstItem.price && firstItem.price.unit_amount !== undefined) {
//       updateData.productPrice = (firstItem.price.unit_amount / 100).toFixed(2);
//     }
//     if (firstItem.price && firstItem.price.product && firstItem.price.product.name) {
//       updateData.productName = firstItem.price.product.name;
//     }
//   }

//   try {
//     const usersRef = db.collection('users').where('stripeCustomerId', '==', customerId);
//     const snapshot = await usersRef.get();

//     if (snapshot.empty) {
//       console.log('No matching user for customer ID:', customerId);
//       return;
//     }

//     const updatePromises:any = [];
//     snapshot.forEach((doc:any) => {
//       updatePromises.push(doc.ref.update(updateData));
//       console.log(`Updated user ${doc.id} subscription to: ${status}`);
//     });

//     await Promise.all(updatePromises);
//   } catch (error) {
//     console.error('Error updating subscription:', error);
//   }
// };

const handleSubscriptionEvent = async (subscription:any, eventType:any) => {
  const customerId = subscription.customer;
  const status = subscription.status;
  console.log('status is', status, eventType)

  // Skip processing if the subscription status is 'incomplete'
  if (status === 'incomplete') {
    console.log(`Skipping Firestore update for subscription with status: ${status}`);
    return;
  }

  const updateData:any = {
    subscriptionStatus: status,
    eventType: eventType,
    updatedBy: 'firebase function',
    subscriptionUpdatedAt: new Date().toLocaleString('en-US', {
      day: '2-digit',
      month: 'short',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hour12: false,
    }),
  };

  // Check if subscription items are present
  if (subscription.items && subscription.items.data && subscription.items.data.length > 0) {
    const firstItem = subscription.items.data[0];
    if (firstItem.price && firstItem.price.unit_amount !== undefined) {
      updateData.productPrice = (firstItem.price.unit_amount / 100).toFixed(2);
    }
    if (firstItem.price && firstItem.price.product) {
      const productId = firstItem.price.product;
      try {
        const product = await stripe.products.retrieve(productId);
        if (product && product.name) {
          updateData.productName = product.name;
        }
      } catch (error) {
        console.error('Error retrieving product:', error);
      }
    }
  }

  try {
    const usersRef = db.collection('users').where('stripeCustomerId', '==', customerId);
    const snapshot = await usersRef.get();

    if (snapshot.empty) {
      console.log('No matching user for customer ID:', customerId);
      return;
    }

    const updatePromises:any = [];
    snapshot.forEach((doc:any) => {
      updatePromises.push(doc.ref.update(updateData));
      console.log(`Updated user ${doc.id} subscription to: ${status}`);
    });

    await Promise.all(updatePromises);
  } catch (error) {
    console.error('Error updating subscription:', error);
  }
};


const handleCheckoutSessionCompleted = async (session:any, eventType:any) => {
  if (session.mode === 'subscription') {
    const subscriptionId = session.subscription;
    try {
      const subscription = await stripe.subscriptions.retrieve(subscriptionId);
      await handleSubscriptionEvent(subscription, eventType);
    } catch (error) {
      console.error('Error retrieving subscription:', error);
    }
  }
};

// Add this new handler for successful payments
const handleInvoicePaid = async (invoice: any) => {
  const subscriptionId = invoice.subscription;
  try {
    const subscription = await stripe.subscriptions.retrieve(subscriptionId);
    await handleSubscriptionEvent(subscription, 'invoice.paid');
  } catch (error) {
    console.error('Error handling paid invoice:', error);
  }
};


// This is your Stripe CLI webhook secret for testing your endpoint locally.
const endpointSecret = "whsec_4b5448b753575d9917b483d3726e9a0c210a235d8e4b8d897daab1f4b67ef79a";
// const endpointSecret = "we_1QpnisGgQs3V8TmTHWAD0aVN";
app.post('/webhook', async (request:any, response:any) => {
  const sig = request.headers['stripe-signature']
  let event;

  try {
    event = stripe.webhooks.constructEvent(request.rawBody, sig, endpointSecret);
  } catch (err:any) {
    return response.status(400).send(`Webhook Error: ${err.message}`);
  }

  // Handle the event
  switch (event.type) {
    case 'invoice.paid':  // Add this case
      await handleInvoicePaid(event.data.object);
      break;
    case 'customer.subscription.created':
    case 'customer.subscription.updated':
    case 'customer.subscription.deleted':
    case 'customer.subscription.paused':
    case 'customer.subscription.resumed':
      await handleSubscriptionEvent(event.data.object, event.type);
      break;
    case 'checkout.session.completed':
    case 'checkout.session.async_payment_succeeded':
      const session = event.data.object;
      if (session.mode === 'subscription') {
        await handleCheckoutSessionCompleted(session, event.type);
      }
      break;
    case 'invoice.payment_succeeded':
      const invoice = event.data.object;
      const subscriptionId = invoice.subscription;
      if (subscriptionId) {
        const subscription = await stripe.subscriptions.retrieve(subscriptionId);
        await handleSubscriptionEvent(subscription, event.type);
      }
      break;
    case 'invoice.payment_failed':
      const failedInvoice = event.data.object;
      const failedSubscriptionId = failedInvoice.subscription;
      if (failedSubscriptionId) {
        const subscription = await stripe.subscriptions.retrieve(failedSubscriptionId);
        await handleSubscriptionEvent(subscription, event.type);
      }
      break;
    default:
      console.log(`Unhandled event type ${event.type}`);
  }

  // Return a 200 response to acknowledge receipt of the event
  response.send();
});
// Export as Firebase Function
exports.api = functions.https.onRequest(app);