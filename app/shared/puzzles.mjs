/* Puzzles (spec 3.2.4, 4.1.5).

   Open-ended, untimed, outside the adaptive path. Several accept more than
   one valid answer, which is the point: a puzzle with exactly one route is
   just a harder exercise. Hints are available but solutions are not given,
   so a puzzle stays worth returning to. */

export const PUZZLES = [
  { id: "pz-triangles", title: "How Many Triangles?", difficulty: 1, topic: "k-2d",
    prompt: "A big triangle is split by lines from each corner to the middle of the opposite side. Counting every size, how many triangles can you find?",
    accepts: [8],
    hints: ["Start with the smallest ones and count those first.",
            "Now look for triangles made of two small ones joined together.",
            "Do not forget the whole big triangle itself."] },

  { id: "pz-handshakes", title: "Everyone Shakes Hands", difficulty: 2, topic: "g3-multprin",
    prompt: "Six people are in a room and everyone shakes hands with everyone else exactly once. How many handshakes happen altogether?",
    accepts: [15],
    hints: ["Each person shakes five hands. What does that give you?",
            "Six people times five handshakes counts every handshake twice.",
            "Divide your total by two, because a handshake needs two people."] },

  { id: "pz-coins", title: "Making Thirty", difficulty: 2, topic: "g2-money",
    prompt: "Using only 5p and 2p coins, how many different ways can you make exactly 30p? (Using none of one kind still counts as a way.)",
    accepts: [4],
    hints: ["Try starting with as many 5p coins as possible, then work down.",
            "Six 5p coins works. Now what if you use five?",
            "Only some numbers of 5p coins leave an amount the 2p coins can finish."] },

  { id: "pz-digits", title: "The Mystery Number", difficulty: 2, topic: "g1-tensones",
    prompt: "I am a two-digit number. My digits add to 11, and my tens digit is 3 more than my ones digit. What number am I?",
    accepts: [74],
    hints: ["Which two digits add to 11?",
            "List them: 2 and 9, 3 and 8, 4 and 7, 5 and 6.",
            "Now find the pair that differs by exactly 3."] },

  { id: "pz-rectangles", title: "Same Area, Different Shape", difficulty: 3, topic: "g3-area",
    prompt: "A rectangle has an area of 36 square units and whole-number sides. What is the SMALLEST perimeter it could have?",
    accepts: [24],
    hints: ["List the pairs of whole numbers that multiply to 36.",
            "Work out the perimeter for each pair.",
            "The closer the two sides are to each other, the smaller the perimeter."] },

  { id: "pz-crossing", title: "The Careful Crossing", difficulty: 3, topic: "g1-grid",
    prompt: "Four people must cross a bridge at night with one torch. They take 1, 2, 5 and 10 minutes. At most two cross at a time, and the torch must come back. What is the shortest total time?",
    accepts: [17],
    hints: ["Sending the fastest person back every time is not the best plan.",
            "Try sending the two slowest across together at some point.",
            "Someone quick needs to already be waiting on the far side when they arrive."] },

  { id: "pz-remainders", title: "Leftovers", difficulty: 4, topic: "g5-congru",
    prompt: "What is the smallest number greater than 1 that leaves a remainder of 1 when divided by 2, 3, 4, 5 and 6?",
    accepts: [61],
    hints: ["A number that leaves remainder 1 is one more than a multiple.",
            "Find the smallest number divisible by 2, 3, 4, 5 and 6.",
            "That least common multiple is 60. Now add the leftover."] },

  { id: "pz-pigeonhole", title: "Socks in the Dark", difficulty: 4, topic: "g5-inclexcl",
    prompt: "A drawer holds red, blue and green socks, plenty of each. Taking socks out in the dark, how many must you take to be CERTAIN of a matching pair?",
    accepts: [4],
    hints: ["Think about the worst possible luck, not the best.",
            "You could take three socks and get one of every colour.",
            "The next sock has to match one you already hold."] },

  /* Puzzles with more than one right answer (3.2.4): any value that satisfies
     the conditions is accepted, so there is genuinely more than one solution
     and more than one way to reach one. */
  { id: "pz-digitsum", title: "Any Nine", difficulty: 1, topic: "g1-tensones",
    prompt: "Give me ANY two-digit number whose digits add up to 9.",
    accepts: [18, 27, 36, 45, 54, 63, 72, 81, 90],
    multiple: true,
    hints: ["Pick a tens digit first, then work out what the ones digit must be.",
            "If the tens digit is 4, the ones digit has to be 5.",
            "There are nine different answers. Any one of them will do."] },
  { id: "pz-rect-perim", title: "Twenty Around", difficulty: 2, topic: "g3-perimeter",
    prompt: "A rectangle has a perimeter of 20 and whole-number sides. Give me the AREA of any such rectangle.",
    accepts: [9, 16, 21, 24, 25],
    multiple: true,
    hints: ["Half the perimeter is the length plus the width.",
            "So the two sides add up to 10. List the pairs.",
            "Multiply the two sides of any pair together; the thinnest rectangle is one option."] },
  { id: "pz-three-primes", title: "Prime Sum", difficulty: 3, topic: "g3-primefact",
    prompt: "Give me any prime number that can be written as the sum of two other primes.",
    accepts: [5, 7, 13, 19, 31, 43, 61, 73],
    multiple: true,
    hints: ["One of the two primes you add must be even — and there is only one even prime.",
            "So you are looking for a prime that is 2 more than another prime.",
            "Start from the smallest odd prime and add two. Check whether the result is prime."] },

  /* Hidden puzzles (5.7): only served once the learner has unlocked the area
     they live in. */
  { id: "pz-vault-locker", title: "The Locker Problem", difficulty: 4, topic: "g4-factorpair", hidden: true, area: "vault",
    prompt: "100 lockers are closed. Person 1 opens every locker. Person 2 toggles every 2nd locker, person 3 every 3rd, and so on up to person 100. How many lockers end up open?",
    accepts: [10],
    hints: ["A locker is toggled once for each factor of its number.",
            "It ends up open if it is toggled an odd number of times.",
            "Which numbers have an odd number of factors? Think about square numbers."] },
  { id: "pz-vault-weights", title: "Four Weights", difficulty: 4, topic: "g5-bases", hidden: true, area: "vault",
    prompt: "With a balance scale and only four weights, you can weigh every whole number of grams from 1 to 40, putting weights on either pan. What is the heaviest of the four weights?",
    accepts: [27],
    hints: ["Weights on the other pan count as negatives.",
            "Try 1 and 3 first: they make 1, 2, 3 and 4.",
            "Each new weight is three times the last."] },
  { id: "pz-observatory-stars", title: "Counting Stars", difficulty: 4, topic: "g5-pascal", hidden: true, area: "observatory",
    prompt: "Seven points sit on a circle, no three in a line. How many triangles can be drawn with corners at three of the points?",
    accepts: [35],
    hints: ["Any three points make a triangle here.",
            "So count the ways to choose 3 points out of 7.",
            "7 × 6 × 5 divided by the 6 orderings of each trio."] }
];

export const publicPuzzle = p => ({
  id: p.id, title: p.title, difficulty: p.difficulty, topic: p.topic, prompt: p.prompt,
  hintCount: p.hints.length, multiple: !!p.multiple, hidden: !!p.hidden, area: p.area || null
});

export const checkPuzzle = (p, answer) => {
  const n = parseFloat(String(answer).replace(/−/g, "-").replace(/[^0-9.\-]/g, ""));
  return !isNaN(n) && p.accepts.some(a => Math.abs(a - n) < 1e-9);
};

export const puzzleById = id => PUZZLES.find(p => p.id === id) || null;
