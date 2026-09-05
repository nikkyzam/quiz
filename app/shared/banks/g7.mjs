/* Grade 7. */
export const G7_BANKS = {
"g7-unitfrac": [
{sec:"R",type:"in",q:"A hose fills 3/4 of a tank in 1/2 hour. At that rate, how many tanks per hour? Type as a decimal.",
 ans:1.5,hint:"Divide the fraction of tank by the fraction of hour.",
 expl:"(3/4) ÷ (1/2) = 3/4 × 2 = 1.5 tanks per hour."},
{sec:"R",type:"in",q:"A recipe uses 1/2 cup of oil for every 1/4 cup of vinegar. How many cups of oil per cup of vinegar?",
 ans:2,expl:"(1/2) ÷ (1/4) = 1/2 × 4 = 2."},
{sec:"R",type:"mc",q:"Which expression finds the unit rate for '2/3 mile in 1/3 hour'?",mono:true,
 opts:["(2/3) ÷ (1/3)","(1/3) ÷ (2/3)","(2/3) × (1/3)","(2/3) + (1/3)"],a:0,
 expl:"A unit rate is 'amount per one hour', so divide the miles by the hours."},
{sec:"R",type:"in",q:"A painter covers 1/4 of a wall in 1/8 hour. How many walls per hour?",
 ans:2,expl:"(1/4) ÷ (1/8) = 1/4 × 8 = 2."},
{sec:"R",type:"in",q:"3/8 of a pizza feeds 1/2 of a group. How many pizzas would feed the WHOLE group? Type as a decimal.",
 ans:0.75,expl:"(3/8) ÷ (1/2) = 3/8 × 2 = 6/8 = 0.75."},
{lvl:2,sec:"R",type:"in",q:"A car uses 3/5 gallon to go 1/4 of a trip. How many gallons for the WHOLE trip?",
 ans:2.4,expl:"(3/5) ÷ (1/4) = 3/5 × 4 = 12/5 = 2.4."},
{lvl:2,sec:"R",type:"in",q:"A worker paints 5/6 of a room in 2/3 hour. How many rooms per hour? Type as a decimal.",
 ans:1.25,expl:"(5/6) ÷ (2/3) = 5/6 × 3/2 = 15/12 = 1.25."},
{lvl:3,sec:"R",type:"in",q:"A hose fills 5/8 of a tank in 5/6 hour. At that rate, how many tanks per hour? Type as a decimal.",
 ans:0.75,expl:"(5/8) ÷ (5/6) = 5/8 × 6/5 = 30/40 = 0.75."}
],

"g7-propor": [
{sec:"R",type:"mc",q:"A table shows: x = 2, y = 6;  x = 4, y = 12;  x = 6, y = 18. Is y proportional to x?",
 opts:["Yes, y = 3x","No","Only sometimes","Cannot tell"],a:0,
 expl:"y ÷ x is always 3, a constant ratio — that is what makes it proportional."},
{sec:"R",type:"in",q:"If y is proportional to x with constant of proportionality 5, what is y when x = 8?",
 ans:40,expl:"y = 5 × 8 = 40."},
{sec:"R",type:"mc",q:"Which equation shows a proportional relationship?",mono:true,
 opts:["y = 4x","y = 4x + 1","y = x²","y = 4/x"],a:0,
 expl:"A proportional relationship has the form y = kx, with no added constant and no exponent."},
{sec:"R",type:"in",q:"A recipe is proportional: 3 cups of flour makes 12 cookies. How many cookies from 5 cups of flour?",
 ans:20,hint:"Find cookies per cup first.",expl:"12 ÷ 3 = 4 cookies per cup, and 4 × 5 = 20."},
{sec:"R",type:"mc",q:"On a graph, a proportional relationship always passes through which point?",mono:true,
 opts:["(0, 0)","(1, 1)","(0, 1)","(1, 0)"],a:0,
 expl:"y = kx always gives y = 0 when x = 0, so the line passes through the origin."},
{lvl:2,sec:"R",type:"in",q:"y is proportional to x. When x = 6, y = 15. What is the constant of proportionality? Type as a decimal.",
 ans:2.5,expl:"15 ÷ 6 = 2.5."},
{lvl:2,sec:"R",type:"mc",q:"Which table is NOT proportional?",mono:true,
 opts:["x: 1, 2, 3  y: 5, 10, 16","x: 1, 2, 3  y: 5, 10, 15","x: 2, 4, 6  y: 3, 6, 9","x: 1, 2, 3  y: 2, 4, 6"],a:0,
 expl:"Every other table keeps y ÷ x constant. The first one breaks the pattern at 16."},
{lvl:3,sec:"R",type:"in",q:"A car uses gas proportionally to distance: 8 gallons for 200 miles. How many gallons for 350 miles?",
 ans:14,hint:"Find the gallons per mile first.",
 expl:"8 ÷ 200 = 0.04 gallons per mile, and 0.04 × 350 = 14."}
],

"g7-ratops": [
{sec:"N",type:"in",q:"−8 + 5 = ?",ans:-3,expl:"−8 + 5 = −3."},
{sec:"N",type:"in",q:"−3 − 7 = ?",ans:-10,expl:"−3 − 7 = −10."},
{sec:"N",type:"in",q:"−4 × −6 = ?",ans:24,expl:"A negative times a negative is positive: −4 × −6 = 24."},
{sec:"N",type:"mc",q:"What is −12 ÷ 4?",opts:["−3","3","−48","48"],a:0,
 expl:"A negative divided by a positive is negative: −12 ÷ 4 = −3."},
{sec:"N",type:"in",q:"6 + (−9) = ?",ans:-3,expl:"6 + (−9) = −3."},
{lvl:2,sec:"N",type:"in",q:"−2.5 + 4.75 = ?",ans:2.25,expl:"−2.5 + 4.75 = 2.25."},
{lvl:2,sec:"N",type:"in",q:"(−3) × (−2) × (−1) = ?",ans:-6,
 hint:"Multiply two at a time.",expl:"(−3) × (−2) = 6, and 6 × (−1) = −6."},
{lvl:3,sec:"N",type:"in",q:"A submarine at −120 feet rises 45 feet, then dives 60 feet. What is its final depth?",
 ans:-135,expl:"−120 + 45 = −75, then −75 − 60 = −135."}
]
};
