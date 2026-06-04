import React, { useState, useEffect } from 'react';
import { View, Text, ScrollView, TouchableOpacity, Alert, ActivityIndicator, Linking } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import * as Location from 'expo-location';
import { MapPin } from 'lucide-react-native';
import { useAuth } from '@/src/context/AuthContext';
import { ref, onValue, set, database } from '@/src/services/firebase';

export default function LocationScreen() {
  const [location, setLocation] = useState<{ latitude: number, longitude: number, timestamp: number } | null>(null);
  const [partnerLocation, setPartnerLocation] = useState<{ latitude: number, longitude: number, timestamp: number } | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [isSyncing, setIsSyncing] = useState(true);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const { myId, partnerId, user, themeColors } = useAuth();

  const partnerName = user?.partnerNickname || 'Partner';

  useEffect(() => {
    if (!myId) return;

    const sharedId = partnerId ? [myId, partnerId].sort().join('_') : myId;
    const locRef = ref(database, `locations/${sharedId}`);

    const unsubscribe = onValue(locRef, (snapshot) => {
      const data = snapshot.val();
      if (data) {
        if (data[myId]) {
          setLocation(data[myId]);
        }
        if (partnerId && data[partnerId]) {
          setPartnerLocation(data[partnerId]);
        }
      }
      setIsSyncing(false);
    }, (error) => {
      console.error('Firebase location error:', error);
      setIsSyncing(false);
    });

    return () => unsubscribe();
  }, [myId, partnerId]);

  const handleShareLocation = async () => {
    if (!myId) return;
    setIsLoading(true);
    setErrorMsg(null);
    try {
      let { status } = await Location.requestForegroundPermissionsAsync();
      if (status !== 'granted') {
        setErrorMsg('Permission to access location was denied');
        setIsLoading(false);
        return;
      }

      let loc = await Location.getCurrentPositionAsync({});
      
      const payload = {
        latitude: loc.coords.latitude,
        longitude: loc.coords.longitude,
        timestamp: Date.now()
      };

      const sharedId = partnerId ? [myId, partnerId].sort().join('_') : myId;
      const myLocRef = ref(database, `locations/${sharedId}/${myId}`);
      await set(myLocRef, payload);
    } catch (e: any) {
      setErrorMsg(e.message);
    } finally {
      setIsLoading(false);
    }
  };

  const handleRequestUpdate = async () => {
    if (!myId) return;
    const sharedId = partnerId ? [myId, partnerId].sort().join('_') : myId;
    const reqRef = ref(database, `locations/${sharedId}/requests/${myId}`);
    try {
      await set(reqRef, Date.now());
      Alert.alert('Request Sent', `Location request sent to ${partnerName}.`);
    } catch (e) {
      console.error('Error requesting location:', e);
      Alert.alert('Error', 'Failed to send request.');
    }
  };

  const getTimeAgo = (timestamp?: number) => {
    if (!timestamp) return '';
    const minDiff = Math.floor((new Date().getTime() - timestamp) / 60000);
    if (minDiff < 1) return 'Just now';
    if (minDiff < 60) return `${minDiff} minutes ago`;
    const hours = Math.floor(minDiff / 60);
    return `${hours} hours ago`;
  };

  if (isSyncing) {
     return (
       <SafeAreaView style={{ flex: 1, backgroundColor: themeColors.background }} className="items-center justify-center">
         <ActivityIndicator size="large" color={themeColors.primary} />
       </SafeAreaView>
     );
  }

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: themeColors.background }}>
      <ScrollView className="flex-1">
        <View className="px-6 py-8">
          <Text style={{ fontSize: 24, fontWeight: 'bold', color: themeColors.text, marginBottom: 8 }}>Location Sharing</Text>
          <Text style={{ color: themeColors.text, opacity: 0.6, marginBottom: 32 }}>Privacy-first GPS tracking.</Text>

          {/* My Location Section */}
          <Text style={{ fontSize: 20, fontWeight: '600', color: themeColors.text, marginBottom: 12 }}>My Location</Text>
          <View style={{ backgroundColor: themeColors.card, padding: 24, borderRadius: 24, borderColor: themeColors.secondary, borderWidth: 1, alignItems: 'center', justifyContent: 'center', marginBottom: 24 }}>
          <View style={{ width: 80, height: 80, backgroundColor: themeColors.secondary, borderRadius: 40, alignItems: 'center', justifyContent: 'center', marginBottom: 16 }}>
            <MapPin size={32} color={themeColors.primary} />
          </View>
          
          {location ? (
            <View className="items-center">
              <TouchableOpacity 
                style={{ backgroundColor: themeColors.secondary, paddingHorizontal: 16, paddingVertical: 8, borderRadius: 24, marginBottom: 12 }}
                onPress={() => Linking.openURL(`https://www.google.com/maps/search/?api=1&query=${location.latitude},${location.longitude}`)}
              >
                <Text style={{ color: themeColors.primary, fontWeight: '600' }}>View on Google Maps</Text>
              </TouchableOpacity>
              <Text style={{ fontSize: 12, color: themeColors.text, opacity: 0.6, marginBottom: 12 }}>
                Lat: {location.latitude.toFixed(4)}, Lon: {location.longitude.toFixed(4)}
              </Text>
              <Text style={{ fontSize: 14, fontWeight: '500', color: themeColors.primary, backgroundColor: themeColors.secondary, paddingHorizontal: 12, paddingVertical: 4, borderRadius: 16 }}>
                Last updated: {getTimeAgo(location.timestamp)}
              </Text>
            </View>
          ) : (
            <Text style={{ color: themeColors.text, opacity: 0.6, fontStyle: 'italic', textAlign: 'center' }}>
              Location not shared yet.{'\n'}Press the button to update your partner.
            </Text>
          )}
          
          {errorMsg && (
            <Text className="text-rose-500 mt-4 text-center">{errorMsg}</Text>
          )}
        </View>

        <TouchableOpacity 
          style={{ backgroundColor: themeColors.primary, paddingVertical: 16, paddingHorizontal: 24, borderRadius: 32, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', marginBottom: 32 }}
          onPress={handleShareLocation}
          disabled={isLoading}
        >
          {isLoading ? (
            <ActivityIndicator color="white" />
          ) : (
            <>
              <MapPin color="white" size={20} className="mr-2" />
              <Text style={{ color: 'white', fontWeight: 'bold', fontSize: 18, marginLeft: 8 }}>Share Location Now</Text>
            </>
          )}
        </TouchableOpacity>

        {/* Partner Location Section */}
        <Text style={{ fontSize: 20, fontWeight: '600', color: themeColors.text, marginBottom: 12 }}>{partnerName}'s Location</Text>
        <View style={{ backgroundColor: themeColors.card, padding: 24, borderRadius: 24, borderColor: themeColors.secondary, borderWidth: 1, alignItems: 'center', justifyContent: 'center', marginBottom: 24 }}>
          <View style={{ width: 80, height: 80, backgroundColor: themeColors.secondary, borderRadius: 40, alignItems: 'center', justifyContent: 'center', marginBottom: 16 }}>
            <MapPin size={32} color={themeColors.primary} />
          </View>
          
          {partnerLocation ? (
            <View className="items-center">
              <TouchableOpacity 
                style={{ backgroundColor: themeColors.secondary, paddingHorizontal: 16, paddingVertical: 8, borderRadius: 24, marginBottom: 12 }}
                onPress={() => Linking.openURL(`https://www.google.com/maps/search/?api=1&query=${partnerLocation.latitude},${partnerLocation.longitude}`)}
              >
                <Text style={{ color: themeColors.primary, fontWeight: '600' }}>View on Google Maps</Text>
              </TouchableOpacity>
              <Text style={{ fontSize: 12, color: themeColors.text, opacity: 0.6, marginBottom: 12 }}>
                Lat: {partnerLocation.latitude.toFixed(4)}, Lon: {partnerLocation.longitude.toFixed(4)}
              </Text>
              <Text style={{ fontSize: 14, fontWeight: '500', color: themeColors.primary, backgroundColor: themeColors.secondary, paddingHorizontal: 12, paddingVertical: 4, borderRadius: 16 }}>
                Last updated: {getTimeAgo(partnerLocation.timestamp)}
              </Text>
            </View>
          ) : (
            <Text style={{ color: themeColors.text, opacity: 0.6, fontStyle: 'italic', textAlign: 'center' }}>
              {partnerName} hasn't shared their location yet.
            </Text>
          )}
        </View>

        <TouchableOpacity 
          style={{ backgroundColor: themeColors.primary, paddingVertical: 16, paddingHorizontal: 24, borderRadius: 32, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', marginBottom: 32 }}
          onPress={handleRequestUpdate}
        >
          <Text style={{ color: 'white', fontWeight: 'bold', fontSize: 18 }}>Request Location Update</Text>
        </TouchableOpacity>

      </View>
    </ScrollView>
    </SafeAreaView>
  );
}
