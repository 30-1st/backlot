// The rooms' safety and privacy page, at /safety. Written for visitors, in plain words.

export function Safety() {
  document.title = 'Safety and privacy';
  return (
    <div className="r-shell r-blank r-doc">
      <main className="r-docmain">
        <h1 className="r-note-title">Safety and privacy</h1>
        <p>This page covers every room on this site. Last updated October 24, 2026.</p>

        <h2>You are chatting with an AI</h2>
        <p>Each room has an AI assistant. It works for the person or business whose room you are in and points you to their own links. It is not them, and it will never say it is a person.</p>

        <h2>If you are going through something hard</h2>
        <p>If you mention wanting to hurt yourself, the assistant stops and shares the 988 Suicide and Crisis Lifeline: call or text 988 in the US, or chat at 988lifeline.org. If you are in danger right now, call 911. It does not suggest anything to buy for the rest of that visit.</p>

        <h2>Money worries</h2>
        <p>If you mention money trouble, like rent, bills or debt, the assistant stops suggesting anything to buy for the rest of that visit.</p>

        <h2>Under 18</h2>
        <p>If you say you are under 18, the assistant stops suggesting anything to buy. Rooms for adult brands ask you to confirm you are 18 or older first, and close the chat if you say you are not.</p>

        <h2>What the assistant will not do</h2>
        <p>No sexual talk, no role-play, no pretending to be your friend or partner, no asking for money, no pressure, and no asking for your name, email, phone number or address.</p>

        <h2>What is kept</h2>
        <p>Rooms ask for nothing about you and set no cookies of their own. Before your first message, Cloudflare runs a quick check that you are not a bot. Your chat is kept for 30 days so the brand&rsquo;s team can check that the assistant behaved, then deleted. Counts with no names (visits, taps) are kept to show the brand what people use. Your internet address is never stored; limits use a scrambled version that changes every day and is deleted within 2 days.</p>

        <h2>Deleting your chat</h2>
        <p>Tap Delete this chat at the bottom of the room, or ask the assistant to delete your chat. It is removed right away.</p>
      </main>
    </div>
  );
}
