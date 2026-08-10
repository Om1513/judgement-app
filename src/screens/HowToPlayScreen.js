import React from "react";
import {
  View,
  Text,
  ImageBackground,
  StyleSheet,
  ScrollView,
} from "react-native";
import { StatusBar } from "expo-status-bar";
import { LinearGradient } from "expo-linear-gradient";
import { useFonts, Bangers_400Regular } from "@expo-google-fonts/bangers";
import { Inter_400Regular, Inter_700Bold } from "@expo-google-fonts/inter";
import CircleIconButton from "../components/CircleIconButton";
import ScreenHeader from "../components/ScreenHeader";
import RuleSection, { RuleText, RuleBullet } from "../components/RuleSection";
import RuleExample, { ExampleLine, Chip, CounterExample } from "../components/RuleExample";
import SuitLegend, { TrumpOrder } from "../components/SuitLegend";
import ScoringExample from "../components/ScoringExample";
import { useResponsive, useScaledStyles } from "../utils/responsive";

// Below this width a single column reads better; above it the cards split into
// two so a landscape phone isn't one narrow ribbon of text down the middle.
const TWO_COLUMN_MIN_WIDTH = 700;

// Which cards go in which column when there are two.
//
// Assigned by hand rather than by alternating index. Two columns that flow
// independently pack much better than a wrapping row grid - no card has to
// stretch to match a neighbour - but it means the split decides how balanced
// the page looks. Scoring is by far the tallest card, so it anchors the left on
// its own; the right takes the short ones, and "Winning the Game" tucks in
// under "Scoreboard" rather than starting a lonely third row.
const LEFT_COLUMN = [0, 2, 4, 6, 8];
const RIGHT_COLUMN = [1, 3, 5, 7, 9, 10];

export default function HowToPlayScreen({ navigation }) {
  const styles = useScaledStyles(rawStyles);
  const r = useResponsive();
  const twoColumn = r.width >= TWO_COLUMN_MIN_WIDTH;

  const [fontsLoaded] = useFonts({
    Bangers_400Regular,
    Inter_400Regular,
    Inter_700Bold,
  });

  if (!fontsLoaded) {
    return (
      <View style={styles.container}>
        <ImageBackground
          source={require("../../assets/background_without_title.png")}
          style={styles.background}
          resizeMode="cover"
        />
      </View>
    );
  }

  // Index order here is the reading order used by the single-column layout, and
  // what LEFT_COLUMN / RIGHT_COLUMN index into.
  const cards = [
    // 0 - Objective
    <RuleSection key="objective" icon="🎯" title="Make Your Judgement">
      <RuleText>
        Before every round you predict how many hands you will win. The goal is
        to match that prediction exactly - no more, no less.
      </RuleText>
      <RuleExample label="Successful judgement" tone="good">
        <ExampleLine left="Bid 2" right="Win exactly 2 hands" tone="good" />
      </RuleExample>
      <RuleExample label="Missed judgement" tone="bad">
        <ExampleLine left="Bid 2" right="Win 1 or 3 hands" tone="bad" />
      </RuleExample>
    </RuleSection>,

    // 1 - Rounds
    <RuleSection key="rounds" icon="🃏" title="Rounds">
      <RuleText>The number of cards dealt increases every round.</RuleText>
      <RuleExample label="A 4-round game">
        <ExampleLine left="Round 1" right="1 card each" />
        <ExampleLine left="Round 2" right="2 cards each" />
        <ExampleLine left="Round 3" right="3 cards each" />
        <ExampleLine left="Round 4" right="4 cards each" />
      </RuleExample>
      <RuleText style={styles.note}>
        A lobby can be set to anywhere from 4 to 8 rounds.
      </RuleText>
    </RuleSection>,

    // 2 - Bidding
    <RuleSection key="bidding" icon="✋" title="Choose Your Bid">
      <RuleText>
        Before any card is played, every player picks how many hands they expect
        to win. You can always bid zero.
      </RuleText>
      <RuleExample label="Valid bids">
        <ExampleLine left="Round 1" right="0 or 1" />
        <ExampleLine left="Round 2" right="0, 1 or 2" />
        <ExampleLine left="Round 3" right="0, 1, 2 or 3" />
      </RuleExample>
      <View style={styles.chipRow}>
        <Chip>0</Chip>
        <Chip highlighted>1</Chip>
        <Chip>2</Chip>
        <Chip>3</Chip>
      </View>
      <RuleText style={styles.note}>
        Once confirmed, your bid is shown to everyone.
      </RuleText>
    </RuleSection>,

    // 3 - Who starts
    <RuleSection key="who-starts" icon="🔄" title="Who Starts">
      <RuleText>The starting player rotates every round.</RuleText>
      <RuleExample label="Between rounds">
        <ExampleLine left="Round 1" right="Player 1 bids and leads first" />
        <ExampleLine left="Round 2" right="Player 2 starts" />
        <ExampleLine left="Round 3" right="Player 3 starts" />
      </RuleExample>
      <RuleExample label="Within a round">
        <ExampleLine left="Win a hand" right="You lead the next one" />
      </RuleExample>
    </RuleSection>,

    // 4 - Trump
    <RuleSection key="trump" icon="👑" title="Trump">
      <RuleText>
        One suit is trump each round. Any trump card beats every card of every
        other suit.
      </RuleText>
      <SuitLegend />
      <RuleText style={styles.subheading}>Kachuful order</RuleText>
      <TrumpOrder />
      <RuleText style={styles.note}>
        The order repeats past round 4. If the lobby is set to Random order,
        trump is drawn fresh each round instead.
      </RuleText>
    </RuleSection>,

    // 5 - Playing a hand
    <RuleSection key="playing" icon="▶️" title="Playing a Hand">
      <RuleBullet>The starting player plays any card.</RuleBullet>
      <RuleBullet>That card&apos;s suit becomes the lead suit.</RuleBullet>
      <RuleBullet>Everyone else must follow the lead suit if they hold it.</RuleBullet>
      <RuleBullet>
        Without the lead suit, play a trump to try to win - or discard any other
        suit.
      </RuleBullet>
      <RuleExample label="The one hard rule" tone="bad">
        <ExampleLine left="Hold the lead suit?" right="You must play it" tone="bad" />
      </RuleExample>
    </RuleSection>,

    // 6 - Who wins the hand
    <RuleSection key="hand-winner" icon="🏅" title="Who Wins the Hand">
      <RuleExample label="No trump played">
        <ExampleLine left="Winner" right="Highest card of the lead suit" />
      </RuleExample>
      <RuleExample label="Trump played">
        <ExampleLine left="Winner" right="Highest trump card" />
      </RuleExample>
      <RuleText style={styles.note}>
        Cards from other non-trump suits can never win a hand.
      </RuleText>
      <RuleText style={styles.subheading}>Card ranking</RuleText>
      <Text style={styles.ranking}>
        2 &lt; 3 &lt; 4 &lt; 5 &lt; 6 &lt; 7 &lt; 8 &lt; 9 &lt; 10 &lt; J &lt; Q &lt; K &lt; A
      </Text>
    </RuleSection>,

    // 7 - Hand counter
    <RuleSection key="counter" icon="🔢" title="Hand Counter">
      <RuleText>
        The number under each player shows hands won against the bid they made.
      </RuleText>
      <View style={styles.chipRow}>
        <CounterExample won={0} bid={2} />
        <CounterExample won={1} bid={2} />
        <CounterExample won={2} bid={2} />
      </View>
      <RuleText style={styles.note}>
        It ticks up as you win hands. Reaching your bid exactly is the goal -
        going past it means a missed judgement.
      </RuleText>
    </RuleSection>,

    // 8 - Scoring
    <RuleSection key="scoring" icon="⭐" title="Scoring">
      <RuleText>
        You only score when your judgement is exact. A wrong prediction scores
        nothing, however close it was.
      </RuleText>
      <ScoringExample mode="+10 mode  ·  10 x Bid" score={(bid) => (bid === 0 ? 10 : bid * 10)} />
      <ScoringExample mode="+1 mode  ·  10 + Bid" score={(bid) => 10 + bid} />
    </RuleSection>,

    // 9 - Scoreboard
    <RuleSection key="scoreboard" icon="📋" title="Scoreboard">
      <RuleText>After each round the scoreboard appears.</RuleText>
      <RuleBullet>Each player&apos;s score for the round</RuleBullet>
      <RuleBullet>The trump that was in play</RuleBullet>
      <RuleBullet>Running totals for everyone</RuleBullet>
      <RuleText style={styles.note}>
        Everyone presses Continue, and the next round starts once every player
        is ready.
      </RuleText>
    </RuleSection>,

    // 10 - Winning the game
    <RuleSection key="winning" icon="🏆" title="Winning the Game">
      <RuleText>
        After the final round every round&apos;s score is added up. The highest total
        wins, with confetti and a final scoreboard.
      </RuleText>
      <RuleExample label="Ties" tone="good">
        <ExampleLine left="Same highest score" right="Joint winners" tone="good" />
      </RuleExample>
    </RuleSection>,
  ];

  return (
    <View style={styles.container}>
      <ImageBackground
        source={require("../../assets/background_without_title.png")}
        style={styles.background}
        resizeMode="cover"
      >
        <LinearGradient
          colors={["rgba(26, 16, 48, 0.82)", "rgba(26, 16, 48, 0.7)", "rgba(26, 16, 48, 0.85)"]}
          locations={[0, 0.45, 1]}
          style={styles.overlayGradient}
        />

        <View
          style={[
            styles.content,
            {
              paddingLeft: r.safeLeft(12),
              paddingRight: r.safeRight(12),
              paddingTop: r.safeTop(8),
              // Prose is capped at a readable measure and centred; a tablet
              // should not smear a paragraph across 1300pt of glass.
              maxWidth: r.maxContentWidth,
              alignSelf: "center",
              width: "100%",
            },
          ]}
        >
          {/* Header stays put; only the rules scroll under it. */}
          <ScreenHeader
            title="How to Play"
            left={
              <CircleIconButton
                inline
                glyph="‹"
                glyphStyle={styles.backGlyph}
                accessibilityLabel="Back to home"
                onPress={() => navigation.goBack()}
              />
            }
          />

          <ScrollView
            style={styles.scroll}
            contentContainerStyle={styles.scrollContent}
            showsVerticalScrollIndicator={false}
          >
            {twoColumn ? (
              <View style={styles.columns}>
                <View style={styles.column}>{LEFT_COLUMN.map((i) => cards[i])}</View>
                <View style={styles.column}>{RIGHT_COLUMN.map((i) => cards[i])}</View>
              </View>
            ) : (
              <View>{cards}</View>
            )}
          </ScrollView>
        </View>

        <StatusBar style="light" hidden />
      </ImageBackground>
    </View>
  );
}

const rawStyles = {
  container: {
    flex: 1,
    backgroundColor: "#1a1030",
  },
  background: {
    flex: 1,
    width: "100%",
    height: "100%",
  },
  overlayGradient: {
    ...StyleSheet.absoluteFillObject,
  },
  content: {
    flex: 1,
  },
  // The chevron sits high and small in its em box, so nudge it onto the optical
  // centre and size it up to match the other screens' back buttons.
  backGlyph: {
    fontSize: 34,
    lineHeight: 38,
    marginTop: -3,
  },
  scroll: {
    flex: 1,
  },
  scrollContent: {
    // Clears the bottom of the screen so the last card isn't flush with the edge.
    paddingBottom: 24,
  },
  columns: {
    flexDirection: "row",
    justifyContent: "space-between",
    // Columns flow independently, so each is only as tall as its own cards.
    alignItems: "flex-start",
  },
  column: {
    width: "49%",
  },
  subheading: {
    marginTop: 9,
    fontSize: 12,
    fontFamily: "Inter_700Bold",
    color: "#FFD700",
    letterSpacing: 1,
    textTransform: "uppercase",
  },
  note: {
    marginTop: 8,
    fontSize: 13,
    color: "#C9BEDC",
  },
  chipRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    alignItems: "center",
    marginTop: 4,
  },
  ranking: {
    marginTop: 5,
    fontSize: 14,
    fontFamily: "Inter_700Bold",
    color: "#FFF8E7",
    letterSpacing: 0.5,
  },
};
