// Password helpers for pdf2txt.
(() => {
    const PASSWORD_STATUS = 'password';

    // Map PDF.js password response codes when available.
    const getPdfPasswordResponses = () => {
        if (window.pdfjsLib && window.pdfjsLib.PasswordResponses) {
            return window.pdfjsLib.PasswordResponses;
        }
        return {};
    };

    const isPasswordError = (err) => {
        if (!err) return false;
        if (err.name === 'PasswordException') return true;
        const message = String(err.message || '').toLowerCase();
        return message.includes('password');
    };

    // Normalize PDF.js password errors into UI-friendly state.
    const getPasswordStateFromError = (err) => {
        const responses = getPdfPasswordResponses();
        const code = err && err.code;
        if (responses && code === responses.INCORRECT_PASSWORD) {
            return { status: PASSWORD_STATUS, errorMsg: null, invalidPassword: true };
        }
        if (responses && code === responses.NEED_PASSWORD) {
            return { status: PASSWORD_STATUS, errorMsg: null, invalidPassword: false };
        }
        const message = String(err && err.message ? err.message : '').toLowerCase();
        if (message.includes('incorrect')) {
            return { status: PASSWORD_STATUS, errorMsg: null, invalidPassword: true };
        }
        return { status: PASSWORD_STATUS, errorMsg: null, invalidPassword: false };
    };

    const shouldShowPasswordField = (fileData) => fileData && fileData.status === PASSWORD_STATUS;

    const getStatusLabel = (status) => {
        if (status === PASSWORD_STATUS) return 'needs password';
        return status;
    };

    const normalizePassword = (value) => typeof value === 'string' ? value : '';

    window.pdf2txtPassword = {
        PASSWORD_STATUS,
        isPasswordError,
        getPasswordStateFromError,
        shouldShowPasswordField,
        getStatusLabel,
        normalizePassword
    };
})();
