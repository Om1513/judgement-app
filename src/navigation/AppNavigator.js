import React from "react";
import { createNativeStackNavigator } from "@react-navigation/native-stack";
import HomeScreen from "../screens/HomeScreen";
import HowToPlayScreen from "../screens/HowToPlayScreen";
import CreateGameScreen from "../screens/CreateGameScreen";
import JoinGameScreen from "../screens/JoinGameScreen";
import LobbyScreen from "../screens/LobbyScreen";
import BiddingScreen from "../screens/BiddingScreen";
import GameTableScreen from "../screens/GameTableScreen";
import ScoreBoardScreen from "../screens/ScoreBoardScreen";
import FinalWinnerScreen from "../screens/FinalWinnerScreen";
import FinalScoreboardScreen from "../screens/FinalScoreboardScreen";

const Stack = createNativeStackNavigator();

export default function AppNavigator() {
  return (
    <Stack.Navigator
      initialRouteName="Home"
      screenOptions={{
        headerShown: false,
        animation: "fade",
        // 400ms of cross-dissolve was long enough to read as a dim gap between
        // screens. Short enough that the two screens overlap rather than the
        // transition having a visible middle.
        animationDuration: 220,
        gestureEnabled: true,
        gestureDirection: "horizontal",
        // Whatever is briefly visible under/between screens. The artwork purple
        // blends into the backgrounds; the previous near-black did not, which
        // is what made every transition look like it passed through a black
        // frame.
        contentStyle: { backgroundColor: "#1a1030" },
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
        name="HowToPlay"
        component={HowToPlayScreen}
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
      <Stack.Screen
        name="Lobby"
        component={LobbyScreen}
        options={{
          animation: "fade",
        }}
      />
      <Stack.Screen
        name="Bidding"
        component={BiddingScreen}
        options={{
          animation: "fade",
          gestureEnabled: false,
        }}
      />
      <Stack.Screen
        name="GameTable"
        component={GameTableScreen}
        options={{
          animation: "fade",
          gestureEnabled: false,
        }}
      />
      <Stack.Screen
        name="ScoreBoard"
        component={ScoreBoardScreen}
        options={{
          animation: "fade",
          gestureEnabled: false,
        }}
      />
      <Stack.Screen
        name="FinalWinner"
        component={FinalWinnerScreen}
        options={{
          animation: "fade",
          gestureEnabled: false,
        }}
      />
      <Stack.Screen
        name="FinalScoreboard"
        component={FinalScoreboardScreen}
        options={{
          animation: "fade",
          gestureEnabled: false,
        }}
      />
    </Stack.Navigator>
  );
}
