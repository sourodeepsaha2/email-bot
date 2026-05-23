const { renderIntroEmail } = require('./templates/emailLayout');

async function test() {
    try {
        const html = await renderIntroEmail("John", "john@test.com", "http://localhost:4000", "HOT");
        require('fs').writeFileSync('./test-email.html', html);
        console.log("HTML generated successfully! Saved to test-email.html.");
    } catch (e) {
        console.error(e);
    }
}
test();
