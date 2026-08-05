const { io } = require('socket.io-client');

const API_URL = 'http://localhost:4001';

// Test credentials
const DRIVER_EMAIL = 'arihosolomon@gmail.com';
const DRIVER_PASSWORD = '12345678';
const PASSENGER_EMAIL = 'testpassenger@example.com';
const PASSENGER_PASSWORD = 'TestPass123';

// Utility to login and get token
async function login(email, password) {
  try {
    const response = await fetch(`${API_URL}/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password }),
    });
    if (!response.ok) {
      const error = await response.json();
      throw new Error(error.message || `HTTP ${response.status}`);
    }
    const data = await response.json();
    console.log(`    ✓ Token obtained (expires in 15 minutes)`);
    return data.accessToken;
  } catch (error) {
    console.error(`    ✗ Login failed:`, error.message);
    throw error;
  }
}

async function testRealtimeTrip() {
  console.log('\n========== REAL-TIME TRIP REQUEST TEST ==========\n');

  let driverSocket, passengerSocket;
  const results = {
    driverConnected: false,
    passengerConnected: false,
    tripRequestReceived: false,
    tripDetails: null,
    locationUpdated: false,
    driverWentOnline: false,
  };

  try {
    // Get auth tokens
    console.log('Step 1: Authenticating users...');
    console.log(`  - Logging in driver (${DRIVER_EMAIL})...`);
    const driverToken = await login(DRIVER_EMAIL, DRIVER_PASSWORD);

    console.log(`  - Logging in passenger (${PASSENGER_EMAIL})...`);
    const passengerToken = await login(PASSENGER_EMAIL, PASSENGER_PASSWORD);

    // Step 2: Connect driver to Socket.IO
    console.log('\nStep 2: Connecting sockets...');
    console.log(`  - Connecting driver socket...`);
    driverSocket = io(API_URL, {
      auth: { token: driverToken },
      reconnection: true,
      reconnectionDelay: 1000,
      reconnectionDelayMax: 5000,
      reconnectionAttempts: 5,
    });

    driverSocket.on('connect', () => {
      results.driverConnected = true;
      console.log(`  ✓ Driver socket connected! ID: ${driverSocket.id}`);
    });

    driverSocket.on('disconnect', (reason) => {
      console.log(`    ! Driver socket disconnected: ${reason}`);
    });

    driverSocket.on('connect_error', (error) => {
      console.error(`    ✗ Driver connection error:`, error.message);
    });

    // Listen for trip requests
    driverSocket.on('trip:requested', (data) => {
      results.tripRequestReceived = true;
      results.tripDetails = data;
      console.log(`  ✓✓ Driver RECEIVED TRIP REQUEST!`);
      console.log(`      - Trip ID: ${data.tripId}`);
      console.log(`      - Pickup: ${data.pickupAddress}`);
      console.log(`      - Destination: ${data.destinationAddress}`);
      console.log(`      - Fare: ${data.fare} UGX`);
      console.log(`      - Ride Type: ${data.rideType}`);
    });

    // Wait for driver connection
    await new Promise((resolve) => {
      const timeout = setTimeout(() => {
        console.log(`    ! Driver connection timeout`);
        resolve();
      }, 5000);

      const checkConnection = () => {
        if (results.driverConnected) {
          clearTimeout(timeout);
          resolve();
        } else {
          setTimeout(checkConnection, 100);
        }
      };
      checkConnection();
    });

    console.log(`  - Connecting passenger socket...`);
    passengerSocket = io(API_URL, {
      auth: { token: passengerToken },
      reconnection: true,
      reconnectionDelay: 1000,
      reconnectionDelayMax: 5000,
      reconnectionAttempts: 5,
    });

    passengerSocket.on('connect', () => {
      results.passengerConnected = true;
      console.log(`  ✓ Passenger socket connected! ID: ${passengerSocket.id}`);
    });

    passengerSocket.on('connect_error', (error) => {
      console.error(`    ✗ Passenger connection error:`, error.message);
    });

    // Wait for passenger connection
    await new Promise((resolve) => {
      const timeout = setTimeout(() => {
        console.log(`    ! Passenger connection timeout`);
        resolve();
      }, 5000);

      const checkConnection = () => {
        if (results.passengerConnected) {
          clearTimeout(timeout);
          resolve();
        } else {
          setTimeout(checkConnection, 100);
        }
      };
      checkConnection();
    });

    // Step 3: Get driver profile and go online
    console.log('\nStep 3: Updating driver location and availability...');
    try {
      let resp = await fetch(`${API_URL}/drivers/me`, {
        headers: { Authorization: `Bearer ${driverToken}` },
      });
      if (!resp.ok) throw new Error(`Failed to get driver profile: HTTP ${resp.status}`);
      const driverProfile = await resp.json();
      console.log(`  - Driver ID: ${driverProfile.id}`);
      console.log(`  - Current location: (${driverProfile.currentLat}, ${driverProfile.currentLng})`);
      console.log(`  - Current status: ${driverProfile.isOnline ? 'ONLINE' : 'OFFLINE'}`);
      console.log(`  - Vehicle rideType: ${driverProfile.vehicle?.rideType}`);

      // Update location FIRST
      console.log(`  - Updating location to test coordinates...`);
      resp = await fetch(`${API_URL}/drivers/me/location`, {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${driverToken}`,
        },
        body: JSON.stringify({ lat: 0.3476, lng: 32.5825 }),
      });
      if (!resp.ok) {
        const error = await resp.json();
        throw new Error(`HTTP ${resp.status}: ${JSON.stringify(error)}`);
      }
      const locationUpdate = await resp.json();
      results.locationUpdated = true;
      console.log(`  ✓ Location updated!`);
      console.log(`    New location: (${locationUpdate.currentLat}, ${locationUpdate.currentLng})`);

      // Go online SECOND (requires location to be set)
      if (!driverProfile.isOnline) {
        console.log(`  - Going online...`);
        resp = await fetch(`${API_URL}/drivers/me/availability`, {
          method: 'PATCH',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${driverToken}`,
          },
          body: JSON.stringify({ isOnline: true }),
        });
        if (!resp.ok) {
          const error = await resp.json();
          throw new Error(`HTTP ${resp.status}: ${JSON.stringify(error)}`);
        }
        results.driverWentOnline = true;
        console.log(`  ✓ Driver is now online`);
      } else {
        console.log(`  ✓ Driver already online`);
        results.driverWentOnline = true;
      }
    } catch (error) {
      console.error(`  ✗ Failed to update driver:`, error.message);
    }

    // Step 4: Passenger requests a ride
    console.log('\nStep 4: Passenger requesting ride...');
    try {
      console.log(`  - Creating trip request...`);
      let resp = await fetch(`${API_URL}/trips`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${passengerToken}`,
        },
        body: JSON.stringify({
          pickupLat: 0.3476,
          pickupLng: 32.5825,
          pickupAddress: 'Old Taxi Park, Kampala',
          destinationLat: 0.3174,
          destinationLng: 32.5853,
          destinationAddress: 'Makerere University, Kampala',
          rideType: 'BODA',
          paymentMethod: 'CASH',
        }),
      });
      if (!resp.ok) {
        const error = await resp.json();
        throw new Error(`HTTP ${resp.status}: ${JSON.stringify(error)}`);
      }
      const tripData = await resp.json();

      const tripId = tripData.trip.id;
      console.log(`  ✓ Trip request created!`);
      console.log(`    - Trip ID: ${tripId}`);
      console.log(`    - Candidate drivers found: ${tripData.candidateDriverCount}`);

      if (tripData.candidateDriverCount === 0) {
        console.log(`  ⚠️  WARNING: No candidate drivers found!`);
        console.log(`      This means the driver at the updated location was not found.`);
        console.log(`      This is the BUG we need to fix.`);
      }

      // Step 5: Wait for driver to receive notification
      console.log('\nStep 5: Waiting for driver to receive trip request (15 seconds)...');
      await new Promise((resolve) => {
        const timeout = setTimeout(() => {
          console.log(`  ! Timeout - driver did not receive notification`);
          resolve();
        }, 15000);

        const checkReceived = () => {
          if (results.tripRequestReceived) {
            clearTimeout(timeout);
            resolve();
          } else {
            setTimeout(checkReceived, 500);
          }
        };
        checkReceived();
      });
    } catch (error) {
      console.error(`  ✗ Error during trip request:`, error.message);
    }

    // Results Summary
    console.log('\n========== TEST RESULTS ==========\n');
    console.log(`Socket.IO Connections:`);
    console.log(`  - Driver connected: ${results.driverConnected ? '✓ YES' : '✗ NO'}`);
    console.log(`  - Passenger connected: ${results.passengerConnected ? '✓ YES' : '✗ NO'}`);
    console.log(`\nDriver Setup:`);
    console.log(`  - Location updated: ${results.locationUpdated ? '✓ YES' : '✗ NO'}`);
    console.log(`  - Went online: ${results.driverWentOnline ? '✓ YES' : '✗ NO'}`);
    console.log(`\nReal-time Communication:`);
    console.log(`  - Trip request received by driver: ${results.tripRequestReceived ? '✓ YES' : '✗ NO'}`);
    if (results.tripDetails) {
      console.log(`    - Fare: ${results.tripDetails.fare}`);
      console.log(`    - Pickup: ${results.tripDetails.pickupAddress}`);
    }

    console.log(`\n========== SUMMARY ==========\n`);
    if (results.driverConnected && results.passengerConnected) {
      if (results.tripRequestReceived) {
        console.log(`✓ SUCCESS: Real-time trip request communication is WORKING!`);
        console.log(`  The driver received the trip request notification via Socket.IO.`);
      } else {
        console.log(`✗ PARTIAL: Socket.IO works but trip requests aren't being delivered`);
        if (results.locationUpdated && !results.tripRequestReceived) {
          console.log(`\n  LIKELY CAUSE: Location update succeeded but 'findNearbyDrivers' in`);
          console.log(`  trips.service.ts is not finding the driver.`);
          console.log(`\n  NEXT STEPS:`);
          console.log(`  1. Check that currentLat/currentLng were actually updated in the database`);
          console.log(`  2. Verify the haversineDistanceKm calculation is correct`);
          console.log(`  3. Check that SEARCH_RADIUS_KM (6km) is large enough`);
          console.log(`  4. Verify driver.isOnline = true in database`);
          console.log(`  5. Verify rideType matches between driver vehicle and trip request`);
        }
      }
    } else {
      console.log(`✗ ISSUE: Socket.IO connections not working`);
      console.log(`  - Driver: ${results.driverConnected ? 'OK' : 'FAILED'}`);
      console.log(`  - Passenger: ${results.passengerConnected ? 'OK' : 'FAILED'}`);
    }
  } catch (error) {
    console.error('\nTest error:', error.message);
  } finally {
    // Cleanup
    if (driverSocket) driverSocket.disconnect();
    if (passengerSocket) passengerSocket.disconnect();
    console.log('\nTest complete.');
  }
}

// Run the test
testRealtimeTrip();
