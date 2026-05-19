import React from "react";
import { createNativeStackNavigator } from "@react-navigation/native-stack";
import HomeScreen from "../screens/HomeScreen";
import CreateGameScreen from "../screens/CreateGameScreen";
import JoinGameScreen from "../screens/JoinGameScreen";

const Stack = createNativeStackNavigator();

export default function AppNavigator() {
  return (
    <Stack.Navigator
      initialRouteName="Home"
      screenOptions={{
        headerShown: false,
        animation: "fade",
        animationDuration: 400,
        gestureEnabled: true,
        gestureDirection: "horizontal",
        contentStyle: { backgroundColor: "#0a0612" },
      }}
    >
      <Stack.Screen
        name="Home"
        component={HomeScreen}
        options={{
          animation: "fade",
        }}
      />
      <Stack.Screen
        name="CreateGame"
        component={CreateGameScreen}
        options={{
          animation: "fade",
        }}
      />
      <Stack.Screen
        name="JoinGame"
        component={JoinGameScreen}
        options={{
          animation: "fade",
        }}
      />
    </Stack.Navigator>
  );
}
