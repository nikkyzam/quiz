/* Grade 6 (additions beyond the coordinate-plane, ratios and percent banks
   that live directly in questions.mjs). */
export const G6_BANKS = {
"g6-unitconv": [
{sec:"R",type:"in",q:"There are 100 centimeters in a meter. How many centimeters are in 3 meters?",
 ans:300,expl:"3 × 100 = 300 centimeters."},
{sec:"R",type:"in",q:"A recipe uses 2 cups. If 1 cup = 8 ounces, how many ounces is that?",
 ans:16,expl:"2 × 8 = 16 ounces."},
{sec:"R",type:"mc",q:"Which ratio converts feet to inches? (1 foot = 12 inches)",mono:true,
 opts:["12 inches : 1 foot","1 inch : 12 feet","1 foot : 1 inch","12 feet : 1 inch"],a:0,
 expl:"The conversion ratio matches the definition: 12 inches for every 1 foot."},
{sec:"R",type:"in",q:"A car travels 60 miles per hour. How many miles in 3 hours?",ans:180,
 expl:"60 × 3 = 180 miles."},
{sec:"R",type:"in",q:"16 ounces = 1 pound. How many ounces are in 2 pounds?",ans:32,
 expl:"2 × 16 = 32 ounces."},
{lvl:2,sec:"R",type:"in",q:"A recipe needs 1.5 pounds of flour. If 1 pound = 16 ounces, how many ounces is that?",
 ans:24,expl:"1.5 × 16 = 24 ounces."},
{lvl:2,sec:"R",type:"in",q:"A car uses gas at a rate of 1 gallon per 25 miles. How many gallons for 150 miles?",
 ans:6,expl:"150 ÷ 25 = 6 gallons."},
{lvl:3,sec:"R",type:"in",q:"A pipe fills at 3 liters per minute. How many liters in 2.5 hours?",
 ans:450,hint:"Convert the hours to minutes first.",
 expl:"2.5 hours = 150 minutes, and 150 × 3 = 450 liters."}
],

"g6-decimals": [
{sec:"D",type:"in",q:"4.75 + 3.6 = ?",ans:8.35,expl:"4.75 + 3.60 = 8.35."},
{sec:"D",type:"in",q:"12.4 − 5.75 = ?",ans:6.65,expl:"12.40 − 5.75 = 6.65."},
{sec:"D",type:"in",q:"2.5 × 1.4 = ?",ans:3.5,expl:"2.5 × 1.4 = 3.5."},
{sec:"D",type:"mc",q:"What is 9.6 ÷ 1.2?",opts:["8","7.2","9.6","10.8"],a:0,
 expl:"9.6 ÷ 1.2 = 8, since 1.2 × 8 = 9.6."},
{sec:"D",type:"in",q:"0.75 × 8 = ?",ans:6,expl:"0.75 × 8 = 6."},
{lvl:2,sec:"D",type:"in",q:"3.25 × 4 = ?",ans:13,expl:"3.25 × 4 = 13."},
{lvl:2,sec:"D",type:"in",q:"A stack of 5 boards is 12.5 cm thick. How thick is ONE board, in cm?",
 ans:2.5,expl:"12.5 ÷ 5 = 2.5 cm."},
{lvl:3,sec:"D",type:"in",q:"A runner's average pace is 6.4 minutes per mile. How many minutes for 3.5 miles?",
 ans:22.4,expl:"6.4 × 3.5 = 22.4 minutes."}
],

"g6-exprexp": [
{sec:"P",type:"in",q:"Evaluate: 3²",ans:9,expl:"3² means 3 × 3 = 9."},
{sec:"P",type:"in",q:"Evaluate: 2⁴",ans:16,expl:"2⁴ means 2 × 2 × 2 × 2 = 16."},
{sec:"P",type:"mc",q:"Which expression equals 5 × 5 × 5?",mono:true,
 opts:["5³","5 × 3","3⁵","15"],a:0,expl:"Three factors of 5 is written as 5 with an exponent of 3: 5³."},
{sec:"P",type:"in",q:"Evaluate: 10³",ans:1000,expl:"10³ = 10 × 10 × 10 = 1000."},
{sec:"P",type:"in",q:"Evaluate: 6² − 4²",ans:20,expl:"6² = 36 and 4² = 16, so 36 − 16 = 20."},
{lvl:2,sec:"P",type:"in",q:"Evaluate: 2³ × 3²",ans:72,expl:"2³ = 8 and 3² = 9, so 8 × 9 = 72."},
{lvl:2,sec:"P",type:"mc",q:"Which is equivalent to 4⁰?",opts:["1","0","4","Undefined"],a:0,
 expl:"Any nonzero number raised to the power of 0 equals 1."},
{lvl:3,sec:"P",type:"in",q:"Evaluate: (2 + 3)² − 2³",ans:17,
 expl:"(2 + 3)² = 5² = 25, and 2³ = 8, so 25 − 8 = 17."}
],

"g6-onevar": [
{sec:"P",type:"in",q:"Solve for x: x + 7 = 15",ans:8,expl:"15 − 7 = 8."},
{sec:"P",type:"in",q:"Solve for x: 3x = 21",ans:7,expl:"21 ÷ 3 = 7."},
{sec:"P",type:"mc",q:"Which value of x makes 2x − 4 = 10 true?",mono:true,
 opts:["7","6","3","5"],a:0,expl:"2 × 7 − 4 = 14 − 4 = 10."},
{sec:"P",type:"in",q:"Solve for x: x/4 = 9",ans:36,expl:"9 × 4 = 36."},
{sec:"P",type:"mc",q:"Which inequality means 'x is at most 5'?",mono:true,
 opts:["x ≤ 5","x < 5","x ≥ 5","x = 5"],a:0,
 expl:"'At most 5' includes 5 itself, which is what ≤ means."},
{lvl:2,sec:"P",type:"in",q:"Solve for x: 5x + 3 = 28",ans:5,expl:"28 − 3 = 25, and 25 ÷ 5 = 5."},
{lvl:2,sec:"P",type:"mc",q:"Which value of x satisfies x − 6 > 2?",mono:true,
 opts:["10","8","6","2"],a:0,expl:"x must be greater than 8. Only 10 satisfies that."},
{lvl:3,sec:"P",type:"in",q:"Solve for x: 2(x + 3) = 16",ans:5,
 expl:"2x + 6 = 16, so 2x = 10 and x = 5."}
]
};
