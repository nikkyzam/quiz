/* Grade 3. */
export const G3_BANKS = {
"g3-mult": [
{sec:"N",type:"in",q:"6 × 4 = ?",ans:24,hint:"Six groups of four.",expl:"6 × 4 = 24."},
{sec:"N",type:"in",q:"7 × 8 = ?",ans:56,expl:"7 × 8 = 56."},
{sec:"N",type:"in",q:"9 × 3 = ?",ans:27,expl:"9 × 3 = 27."},
{sec:"N",type:"mc",q:"Which is the same as 5 × 6?",mono:true,opts:["6 × 5","5 + 6","6 + 6","5 × 5"],a:0,
 expl:"Multiplication can be done in either order, so 5 × 6 = 6 × 5 = 30."},
{sec:"N",type:"in",q:"A spider has 8 legs. How many legs do 4 spiders have?",ans:32,
 expl:"4 × 8 = 32 legs."},
{lvl:2,sec:"N",type:"in",q:"8 × 7 = ?",ans:56,hint:"It is the same as 7 × 8.",
 expl:"8 × 7 = 56 — the same product as 7 × 8, just the other way round."},
{lvl:2,sec:"N",type:"multi",q:"Select EVERY expression equal to 24.",
 opts:["6 × 4","3 × 8","12 × 2","5 × 5"],aMulti:[0,1,2],
 expl:"6 × 4, 3 × 8 and 12 × 2 all make 24. 5 × 5 is 25."},
{lvl:2,sec:"N",type:"in",q:"What is 4 × 25?",ans:100,hint:"Think of quarters of a hundred.",
 expl:"25 four times is 100 — like four 25p coins making £1."},
{lvl:3,sec:"N",type:"in",q:"A room has 6 rows of 7 chairs. If 5 chairs are removed, how many remain?",
 ans:37,hint:"Find the total first.",expl:"6 × 7 = 42 chairs, minus 5 removed leaves 37."},
{lvl:3,sec:"N",type:"in",q:"What is the 8th number in the pattern 3, 6, 9, 12, ...?",ans:24,
 hint:"It counts up in threes.",expl:"The pattern is multiples of 3, so the 8th is 8 × 3 = 24."}
],

"g3-fracnum": [
{sec:"F",type:"mc",q:"A pizza is cut into 4 equal slices and you eat 1. What fraction did you eat?",
 mono:true,opts:["1/4","1/3","4/1","3/4"],a:0,
 expl:"One slice out of four equal slices is 1/4."},
{sec:"F",type:"mc",q:"Which fraction is the largest?",mono:true,opts:["1/2","1/3","1/4","1/8"],a:0,
 expl:"The more pieces you cut something into, the smaller each piece. Halves are the biggest here."},
{sec:"F",type:"in",q:"How many quarters make one whole?",ans:4,
 expl:"Four quarters make a whole: 1/4 + 1/4 + 1/4 + 1/4 = 1."},
{sec:"F",type:"mc",q:"Which is the same as 2/4?",mono:true,opts:["1/2","1/4","3/4","2/2"],a:0,
 expl:"Two quarters is the same amount as one half."},
{lvl:2,sec:"F",type:"order",q:"Put these fractions in order, smallest first.",
 items:["1/2","1/8","1/3","1/4"],ansOrder:["1/8","1/4","1/3","1/2"],
 expl:"With a numerator of 1, the bigger the bottom number the smaller the fraction."},
{lvl:2,sec:"F",type:"mc",q:"Which fraction is closest to 1 whole?",mono:true,
 opts:["7/8","1/2","3/4","2/3"],a:0,
 expl:"7/8 is only 1/8 short of a whole, closer than the others."},
{lvl:3,sec:"F",type:"in",q:"Three friends share 2 pizzas equally. What fraction of a pizza does each get? Type the bottom number of the fraction.",
 ans:3,hint:"Each pizza is split three ways.",
 expl:"Each pizza splits into thirds, so each friend gets 2/3 of a pizza. The bottom number is 3."}
],

"g3-area": [
{sec:"G",type:"in",q:"A rectangle is 5 squares long and 3 squares wide. What is its area in square units?",ans:15,
 hint:"Count the squares, or multiply.",expl:"Area = 5 × 3 = 15 square units."},
{sec:"G",type:"in",q:"A square has sides of 4 units. What is its area in square units?",ans:16,
 expl:"A square's sides are equal, so area = 4 × 4 = 16 square units."},
{sec:"G",type:"mc",q:"What does area measure?",
 opts:["The space inside a shape","The distance around a shape","The number of corners","The longest side"],a:0,
 expl:"Area is the space inside. The distance around the outside is the perimeter."},
{lvl:2,sec:"G",type:"in",q:"A rectangle has an area of 24 square units and is 6 units long. How wide is it?",
 ans:4,hint:"What times 6 makes 24?",expl:"6 × 4 = 24, so the width is 4 units."},
{lvl:2,sec:"G",type:"in",q:"An L-shape is made from a 3 by 2 rectangle joined to a 2 by 2 square. What is the total area in square units?",
 ans:10,hint:"Work out each piece, then add.",
 expl:"The rectangle is 3 × 2 = 6 and the square is 2 × 2 = 4. Together 6 + 4 = 10 square units."},
{lvl:3,sec:"G",type:"in",q:"A rectangle has an area of 36 square units and a perimeter of 26 units. What is its longer side?",
 ans:9,hint:"Which pair multiplies to 36 and adds to 13?",
 expl:"Half the perimeter is 13, so the sides add to 13 and multiply to 36. That is 9 and 4, so the longer side is 9."}
]
};
