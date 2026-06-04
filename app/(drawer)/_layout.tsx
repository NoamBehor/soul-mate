import { Drawer } from 'expo-router/drawer';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { Home, Calendar, Heart, MapPin, Image as ImageIcon, Activity, Settings, MessageSquare } from 'lucide-react-native';
import { useAuth } from '@/src/context/AuthContext';

export default function DrawerLayout() {
  const { themeColors } = useAuth();

  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <Drawer
        screenOptions={{
          headerShown: true,
          headerStyle: {
            backgroundColor: themeColors.card,
          },
          headerTintColor: themeColors.primary,
          headerTitleStyle: {
            fontWeight: 'bold',
          },
          drawerActiveTintColor: themeColors.primary,
          drawerInactiveTintColor: '#94a3b8',
        }}>
        <Drawer.Screen
          name="index"
          options={{
            drawerLabel: 'Home',
            title: 'SoulSync',
            drawerIcon: ({ color, size }) => <Home size={size} color={color} />,
          }}
        />
        <Drawer.Screen
          name="chat"
          options={{
            drawerLabel: 'Chat',
            title: 'Chat',
            drawerIcon: ({ color, size }) => <MessageSquare size={size} color={color} />,
          }}
        />
        <Drawer.Screen
          name="calendar"
          options={{
            drawerLabel: 'Calendar',
            title: 'Our Calendar',
            drawerIcon: ({ color, size }) => <Calendar size={size} color={color} />,
          }}
        />
        <Drawer.Screen
          name="dates"
          options={{
            drawerLabel: 'Date Ideas',
            title: 'Date Ideas',
            drawerIcon: ({ color, size }) => <Heart size={size} color={color} />,
          }}
        />
        <Drawer.Screen
          name="location"
          options={{
            drawerLabel: 'Location',
            title: 'Location Sharing',
            drawerIcon: ({ color, size }) => <MapPin size={size} color={color} />,
          }}
        />
        <Drawer.Screen
          name="board"
          options={{
            drawerLabel: 'Memories',
            title: 'Memories',
            drawerIcon: ({ color, size }) => <ImageIcon size={size} color={color} />,
          }}
        />
        <Drawer.Screen
          name="cycle"
          options={{
            drawerLabel: 'Cycle Tracker',
            title: 'Cycle Tracker',
            drawerIcon: ({ color, size }) => <Activity size={size} color={color} />,
          }}
        />
        <Drawer.Screen
          name="settings"
          options={{
            drawerLabel: 'Settings',
            title: 'Settings',
            drawerIcon: ({ color, size }) => <Settings size={size} color={color} />,
          }}
        />

        {/* We want to hide screens that shouldn't appear in the drawer explicitly */}
        <Drawer.Screen
          name="profile"
          options={{
            drawerItemStyle: { display: 'none' }, // Hide existing profile if it's there
          }}
        />
        <Drawer.Screen
          name="explore"
          options={{
            drawerItemStyle: { display: 'none' }, // Hide existing explore
          }}
        />
      </Drawer>
    </GestureHandlerRootView>
  );
}
