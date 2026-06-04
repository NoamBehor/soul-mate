import React, { useState, useEffect } from 'react';
import { View, Text, ScrollView, ActivityIndicator, TouchableOpacity, Modal, TextInput, Alert, Platform } from 'react-native';
import { Plus, X } from 'lucide-react-native';
import * as ExpoCalendar from 'expo-calendar';
import { Calendar as CalendarGrid } from 'react-native-calendars';
import { useAuth } from '@/src/context/AuthContext';
import { ref, onValue, push, set, database } from '@/src/services/firebase';
import { getPeriodDates } from '@/src/utils/cycleLogic';
import { fetchCycleLogs, CycleLog } from '@/src/services/cycleService';

export default function CalendarScreen() {
  const { myId, partnerId, themeColors, user } = useAuth();
  const [isLoading, setIsLoading] = useState(true);
  const [expoEvents, setExpoEvents] = useState<any[]>([]);
  const [firebaseEvents, setFirebaseEvents] = useState<any[]>([]);
  const [modalVisible, setModalVisible] = useState(false);
  const [newEvent, setNewEvent] = useState({ title: '', date: '', time: '' });
  const [selectedDate, setSelectedDate] = useState(new Date().toISOString().split('T')[0]);
  const [cycleLogs, setCycleLogs] = useState<CycleLog[]>([]);

  const events = [...expoEvents, ...firebaseEvents].sort((a: any, b: any) => new Date(a.event_date).getTime() - new Date(b.event_date).getTime());

  useEffect(() => {
    (async () => {
      const { status: calStatus } = await ExpoCalendar.requestCalendarPermissionsAsync();
      
      if (calStatus === 'granted') {
        loadData();
      } else {
        setIsLoading(false);
      }
    })();
  }, []);

  // Fetch cycle logs from Supabase for period highlighting
  useEffect(() => {
    if (!myId) return;
    const pairId = partnerId ? [myId, partnerId].sort().join('_') : myId;
    fetchCycleLogs(pairId)
      .then((logs) => setCycleLogs(logs))
      .catch((err) => console.warn('[Calendar] fetchCycleLogs failed:', err?.message));
  }, [myId, partnerId]);

  useEffect(() => {
    if (!myId) return;
    const sharedId = partnerId ? [myId, partnerId].sort().join('_') : myId;
    const calRef = ref(database, `calendar/${sharedId}`);

    const unsubscribe = onValue(calRef, (snapshot) => {
      const data = snapshot.val();
      if (data) {
        const fbEvents = Object.keys(data).map(key => ({
          id: key,
          ...data[key]
        }));
        setFirebaseEvents(fbEvents);
      } else {
        setFirebaseEvents([]);
      }
    });

    return () => unsubscribe();
  }, [myId, partnerId]);

  const loadData = async () => {
    try {
      let fetchedEvents: any[] = [];
      try {
        const calendars = await ExpoCalendar.getCalendarsAsync(ExpoCalendar.EntityTypes.EVENT);
        const targetCals = calendars.filter(c => c.source.name === 'Default' || c.source.type === 'com.google');
        
        if (targetCals.length > 0) {
          const start = new Date();
          const end = new Date();
          end.setMonth(end.getMonth() + 6); // Look 6 months ahead
          
          const cals = await ExpoCalendar.getEventsAsync(targetCals.map(c => c.id), start, end);
          fetchedEvents = cals.map((e: any) => ({
            id: e.id,
            title: e.title,
            event_date: e.startDate,
            event_type: 'Calendar Sync'
          }));
        }
      } catch (err) {
        console.warn('Could not fetch calendar events', err);
      }

      const mockEvents = [
        { id: '1', title: 'First Date Anniversary', event_date: '2027-04-10T00:00:00Z', event_type: 'Anniversary' },
        { id: '2', title: 'Vacation', event_date: '2027-06-15T00:00:00Z', event_type: 'Trip' }
      ];
      
      const allEvents = [...mockEvents, ...fetchedEvents];
      setExpoEvents(allEvents);

    } catch (error) {
      console.error('Error loading calendar:', error);
    } finally {
      setIsLoading(false);
    }
  };

  const handleCreateEvent = async () => {
    if (!newEvent.title || !newEvent.date) {
      Alert.alert('Error', 'Please enter at least a title and date (YYYY-MM-DD)');
      return;
    }

    try {
      const dateStr = `${newEvent.date}T${newEvent.time || '12:00'}:00Z`;
      
      const newObj = {
        title: newEvent.title,
        event_date: dateStr,
        event_type: 'Custom',
        createdAt: Date.now(),
        createdBy: myId
      };

      if (myId) {
        const sharedId = partnerId ? [myId, partnerId].sort().join('_') : myId;
        const calRef = ref(database, `calendar/${sharedId}`);
        const newEventRef = push(calRef);
        await set(newEventRef, newObj);
      }

      setModalVisible(false);
      setNewEvent({ title: '', date: '', time: '' });
      Alert.alert("Success", "Event created and synced.");

    } catch(err) {
      console.error(err);
      Alert.alert('Error', 'Could not create event');
    }
  };

  const openAddEventModal = () => {
    setNewEvent({ title: '', date: selectedDate, time: '' });
    setModalVisible(true);
  };

  if (isLoading) {
    return (
      <View className="flex-1 items-center justify-center bg-rose-50">
        <ActivityIndicator size="large" color="#f43f5e" />
      </View>
    );
  }

  const gender = user?.gender?.toLowerCase() || 'female';
  const bgColor = themeColors.background;
  const textColor = themeColors.text;
  const eventBg = themeColors.card;

  const periodDates = getPeriodDates(cycleLogs);
  
  const markedDates: any = {};

  periodDates.forEach((dateStr) => {
    markedDates[dateStr] = { dots: [{ key: 'period', color: '#FFB6C1' }] }; // Soft Pink
  });

  events.forEach((current) => {
    const dateSection = current.event_date.split('T')[0];
    if (!markedDates[dateSection]) {
      markedDates[dateSection] = { dots: [] };
    }
    if (!markedDates[dateSection].dots.some((d: any) => d.key === 'event')) {
      markedDates[dateSection].dots.push({ key: 'event', color: '#f43f5e' });
    }
  });

  if (markedDates[selectedDate]) {
    markedDates[selectedDate].selected = true;
    markedDates[selectedDate].selectedColor = '#f43f5e';
  } else {
    markedDates[selectedDate] = { selected: true, selectedColor: '#f43f5e', dots: [] };
  }

  const selectedEvents = events.filter(e => e.event_date.startsWith(selectedDate));

  return (
    <View style={{ flex: 1, backgroundColor: bgColor }}>
      <ScrollView className="flex-1">
        <View className="px-6 py-8 mt-12">
          <View className="flex-row justify-between items-center mb-2">
            <Text style={{ color: themeColors.text, fontSize: 24, fontWeight: 'bold' }}>Our Calendar 📅</Text>
            <TouchableOpacity 
              onPress={openAddEventModal}
              style={{ backgroundColor: themeColors.primary, width: 40, height: 40, borderRadius: 20, alignItems: 'center', justifyContent: 'center', shadowColor: '#000', shadowOffset: { width: 0, height: 2 }, shadowOpacity: 0.2, shadowRadius: 4, elevation: 4 }}
            >
              <Plus color="white" size={24} />
            </TouchableOpacity>
          </View>
          <View className="mb-6">
            <CalendarGrid
              current={selectedDate}
              onDayPress={(day: any) => setSelectedDate(day.dateString)}
              markedDates={markedDates}
              markingType={'multi-dot'}
              theme={{
                calendarBackground: 'transparent',
                textSectionTitleColor: '#475569',
                selectedDayBackgroundColor: themeColors.primary,
                selectedDayTextColor: '#ffffff',
                todayTextColor: themeColors.primary,
                dayTextColor: '#334155',
                textDisabledColor: '#cbd5e1',
                dotColor: themeColors.primary,
                selectedDotColor: '#ffffff',
                arrowColor: themeColors.primary,
                monthTextColor: themeColors.text,
                indicatorColor: themeColors.primary,
                textDayFontWeight: '500',
                textMonthFontWeight: 'bold',
                textDayHeaderFontWeight: '600'
              }}
            />
          </View>
          <Text className="text-slate-500 mb-6">
            Events on {(() => {
              const [y, m, d] = selectedDate.split('-').map(Number);
              return new Date(Date.UTC(y, m - 1, d)).toLocaleDateString(undefined, { timeZone: 'UTC' });
            })()}
          </Text>
          
          {selectedEvents.length === 0 ? (
            <Text className="text-slate-500">No events found for this day.</Text>
          ) : (
            <View className="border-l-2 border-rose-300 ml-4 pl-4 space-y-6">
              {selectedEvents.map((event, index) => {
                const dateObj = new Date(event.event_date);
                const dateString = dateObj.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
                
                return (
                  <View key={event.id || index} className="relative mb-6">
                    <View style={{ backgroundColor: themeColors.primary, position: 'absolute', left: -23, top: 16, width: 14, height: 14, borderRadius: 7, shadowColor: '#000', shadowOpacity: 0.1, shadowRadius: 2, shadowOffset: { width: 0, height: 1 } }} />
                    
                    <View style={{ backgroundColor: themeColors.card, borderRadius: 12, padding: 16, shadowColor: '#000', shadowOffset: { width: 0, height: 1 }, shadowOpacity: 0.05, shadowRadius: 3, elevation: 1, borderWidth: 1, borderColor: themeColors.secondary }}>
                      <Text style={{ fontWeight: '600', fontSize: 18, color: themeColors.text }}>{event.title}</Text>
                      {event.description ? (
                        <Text className="text-sm text-slate-700 mt-1">{event.description}</Text>
                      ) : null}
                      <View className="mt-2 flex-row justify-between items-center">
                        <Text style={{ fontSize: 12, fontWeight: '500', color: themeColors.primary, backgroundColor: themeColors.secondary, paddingHorizontal: 8, paddingVertical: 4, borderRadius: 12, overflow: 'hidden' }}>
                          {event.event_type || 'Event'}
                        </Text>
                        <Text className="text-sm font-semibold text-slate-600">{dateString}</Text>
                      </View>
                    </View>
                  </View>
                );
              })}
            </View>
          )}
        </View>
      </ScrollView>

      {/* Add Event Modal */}
      <Modal
        animationType="slide"
        transparent={true}
        visible={modalVisible}
        onRequestClose={() => setModalVisible(false)}
      >
        <View className="flex-1 justify-end bg-black/40">
          <View className="bg-white rounded-t-3xl p-6 h-[70%]">
            <View className="flex-row justify-between items-center mb-6">
              <Text className="text-xl font-bold text-gray-800">Add New Event</Text>
              <TouchableOpacity onPress={() => setModalVisible(false)}>
                <X color="#4b5563" size={24} />
              </TouchableOpacity>
            </View>

            <View className="space-y-4">
              <View>
                <Text className="text-gray-600 mb-2 font-medium">Event Title</Text>
                <TextInput
                  value={newEvent.title}
                  onChangeText={(t) => setNewEvent({...newEvent, title: t})}
                  placeholder="e.g. Dinner Date"
                  placeholderTextColor="#9ca3af"
                  className="bg-gray-100 p-4 rounded-xl text-gray-800"
                />
              </View>

              <View>
                <Text className="text-gray-600 mb-2 font-medium">Date (YYYY-MM-DD)</Text>
                <TextInput
                  value={newEvent.date}
                  onChangeText={(t) => setNewEvent({...newEvent, date: t})}
                  placeholder="2024-12-25"
                  placeholderTextColor="#9ca3af"
                  className="bg-gray-100 p-4 rounded-xl text-gray-800"
                />
              </View>

              <View>
                <Text className="text-gray-600 mb-2 font-medium">Time (HH:MM) - Optional</Text>
                <TextInput
                  value={newEvent.time}
                  onChangeText={(t) => setNewEvent({...newEvent, time: t})}
                  placeholder="19:00"
                  placeholderTextColor="#9ca3af"
                  className="bg-gray-100 p-4 rounded-xl text-gray-800"
                />
              </View>

              <TouchableOpacity 
                onPress={handleCreateEvent}
                style={{ backgroundColor: themeColors.primary, paddingVertical: 16, borderRadius: 12, alignItems: 'center', marginTop: 16, shadowColor: '#000', shadowOffset: { width: 0, height: 1 }, shadowOpacity: 0.1, shadowRadius: 2, elevation: 2 }}
              >
                <Text className="text-white font-bold text-lg">Save Event</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>
    </View>
  );
}
