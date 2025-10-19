// File: api/get-barcode-url.ts
// This is the Vercel Serverless Function that runs on the server.

import { createClient } from '@supabase/supabase-js';

// The handler function that Vercel will run
export default async function handler(request, response) {
  // Allow requests from any origin (CORS). Important for local testing and production.
  response.setHeader('Access-Control-Allow-Origin', '*');
  response.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  response.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  // Handle the browser's preflight OPTIONS request
  if (request.method === 'OPTIONS') {
    return response.status(200).end();
  }

  // Get the barcode number from the URL query, e.g., ?number=1
  const barcodeNumber = request.query.number;

  if (!barcodeNumber) {
    return response.status(400).json({ error: 'Barcode number is required.' });
  }

  try {
    // These process.env variables are securely provided by Vercel from your Project Settings
    const supabaseUrl = process.env.VITE_SUPABASE_URL;
    const supabaseKey = process.env.SUPABASE_SERVICE_KEY;

    // Ensure the environment variables are set in Vercel
    if (!supabaseUrl || !supabaseKey) {
        throw new Error('Supabase environment variables are not set correctly in Vercel project settings.');
    }

    // Create a Supabase client using the secure service_role key
    const supabase = createClient(supabaseUrl, supabaseKey);

    // Query your 'barcodes' table
    const { data, error } = await supabase
      .from('barcodes')
      .select('image_url')
      .eq('barcode_number', barcodeNumber)
      .single(); // .single() expects exactly one result

    // If there's an error or no data is found, throw an error
    if (error || !data) {
      throw new Error(`Barcode with number '${barcodeNumber}' could not be found in the database.`);
    }

    // If successful, return the found image URL in JSON format
    return response.status(200).json({ imageUrl: data.image_url });

  } catch (error) {
    // If any error occurs, return a descriptive error message
    return response.status(404).json({ error: error.message });
  }
}
