// DOM 서비스 클래스 정의
class DomService {
    constructor() {
        this.xpathCache = {};
    }

    // 클릭 가능한 요소들 가져오기
    async getClickableElements(highlightElements = true, focusElement = -1, viewportExpansion = 0) {
        const args = {
            doHighlightElements: highlightElements,
            focusHighlightIndex: focusElement,
            viewportExpansion: viewportExpansion,
            debugMode: false
        };

        try {
            const result = await this.buildDomTree(args);
            return {
                elementTree: result.elementTree,
                selectorMap: result.selectorMap
            };
        } catch (error) {
            console.error('Error getting clickable elements:', error);
            throw error;
        }
    }

    // DOM 트리 구축
    async buildDomTree(args) {
        if (document.readyState !== 'complete') {
            throw new Error('Page is not fully loaded');
        }

        const elementTree = await this._buildElementTree(document.body);
        const selectorMap = this._createSelectorMap(elementTree);

        return {
            elementTree,
            selectorMap
        };
    }

    // 요소 트리 구축
    async _buildElementTree(element, parent = null) {
        const node = {
            tagName: element.tagName.toLowerCase(),
            xpath: this._getXPath(element),
            attributes: this._getAttributes(element),
            children: [],
            isVisible: this._isElementVisible(element),
            isInteractive: this._isElementInteractive(element),
            isInViewport: this._isInViewport(element),
            parent: parent
        };

        // 자식 요소 처리
        for (const child of element.children) {
            const childNode = await this._buildElementTree(child, node);
            node.children.push(childNode);
        }

        return node;
    }

    // XPath 생성
    _getXPath(element) {
        if (this.xpathCache[element]) {
            return this.xpathCache[element];
        }

        if (element.id) {
            return `//*[@id="${element.id}"]`;
        }

        let path = '';
        while (element && element.nodeType === Node.ELEMENT_NODE) {
            let index = 1;
            let sibling = element.previousSibling;
            while (sibling) {
                if (sibling.nodeType === Node.ELEMENT_NODE && sibling.tagName === element.tagName) {
                    index++;
                }
                sibling = sibling.previousSibling;
            }
            const tagName = element.tagName.toLowerCase();
            path = `/${tagName}[${index}]${path}`;
            element = element.parentNode;
        }

        this.xpathCache[element] = path;
        return path;
    }

    // 요소의 속성 가져오기
    _getAttributes(element) {
        const attributes = {};
        for (const attr of element.attributes) {
            attributes[attr.name] = attr.value;
        }
        return attributes;
    }

    // 요소가 보이는지 확인
    _isElementVisible(element) {
        const style = window.getComputedStyle(element);
        return style.display !== 'none' && 
               style.visibility !== 'hidden' && 
               style.opacity !== '0' &&
               element.offsetWidth > 0 &&
               element.offsetHeight > 0;
    }

    // 요소가 상호작용 가능한지 확인
    _isElementInteractive(element) {
        const interactiveTags = ['a', 'button', 'input', 'select', 'textarea'];
        const role = element.getAttribute('role');
        const tabIndex = element.getAttribute('tabindex');

        return interactiveTags.includes(element.tagName.toLowerCase()) ||
               role === 'button' ||
               role === 'link' ||
               role === 'checkbox' ||
               role === 'radio' ||
               role === 'textbox' ||
               (tabIndex !== null && tabIndex !== '-1');
    }

    // 요소가 뷰포트 내에 있는지 확인
    _isInViewport(element) {
        const rect = element.getBoundingClientRect();
        return (
            rect.top >= 0 &&
            rect.left >= 0 &&
            rect.bottom <= (window.innerHeight || document.documentElement.clientHeight) &&
            rect.right <= (window.innerWidth || document.documentElement.clientWidth)
        );
    }

    // 선택자 맵 생성
    _createSelectorMap(elementTree) {
        const selectorMap = {};
        let index = 0;

        const processNode = (node) => {
            if (node.isInteractive && node.isVisible) {
                selectorMap[index] = node;
                index++;
            }
            for (const child of node.children) {
                processNode(child);
            }
        };

        processNode(elementTree);
        return selectorMap;
    }
}

// DOM 서비스 인스턴스 생성
const domService = new DomService();

// 메시지 리스너 설정
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    if (request.type === 'GET_CLICKABLE_ELEMENTS') {
        domService.getClickableElements()
            .then(result => sendResponse({ success: true, data: result }))
            .catch(error => sendResponse({ success: false, error: error.message }));
        return true;
    }
}); 