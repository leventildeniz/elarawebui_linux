const subAnswer = "Here is the plan:\npython\nprint(1)\n\nHope it helps!";
let extractedJsonText = subAnswer;
const jsonMatch = subAnswer.match(//i);
if (jsonMatch && jsonMatch[1]) {
    extractedJsonText = jsonMatch[1];
}
console.log("EXTRACTED:");
console.log(extractedJsonText);
