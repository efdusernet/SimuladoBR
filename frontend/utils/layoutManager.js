/**
 * Layout Manager - Sistema de detecção e gerenciamento de layouts responsivos
 * Suporta: mobile (< 768px), desktop (≥ 768px), fullscreen
 */

const LayoutManager = {
  // Configuração
  BREAKPOINT: 768,
  RESIZE_DEBOUNCE: 250,
  
  // Estado
  currentLayout: null,
  previousLayout: null,
  isFullscreen: false,
  fullscreenPage: null,
  resizeTimer: null,
  
  // Callbacks
  onLayoutChange: [],
  
  /**
   * Inicializa o gerenciador de layouts
   */
  init() {
    logger.info('[LayoutManager] Inicializando...');
    
    // Detectar e aplicar layout inicial
    this.detectAndApply();
    
    // Listeners para mudanças
    window.addEventListener('resize', () => this.handleResize());
    window.addEventListener('orientationchange', () => this.handleOrientationChange());
    
    // Listener para tecla ESC (sair de fullscreen)
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && this.isFullscreen) {
        this.exitFullscreen();
      }
    });
    
    logger.info('[LayoutManager] Inicializado. Layout:', this.currentLayout);
  },
  
  /**
   * Detecta viewport e aplica layout apropriado
   */
  detectAndApply() {
    if (this.isFullscreen) {
      logger.info('[LayoutManager] Em modo fullscreen, pulando detecção');
      return;
    }
    
    const width = window.innerWidth;
    const newLayout = width >= this.BREAKPOINT ? 'desktop' : 'mobile';
    
    if (newLayout !== this.currentLayout) {
      logger.info(`[LayoutManager] Mudando layout: ${this.currentLayout} → ${newLayout}`);
      this.switchLayout(newLayout);
    }
  },
  
  /**
   * Troca entre layouts
   */
  switchLayout(layout) {
    this.previousLayout = this.currentLayout;
    this.currentLayout = layout;
    
    // Atualizar atributo no body
    document.body.setAttribute('data-layout', layout);
    
    // Carregar componentes específicos do layout
    if (layout === 'desktop') {
      this.loadDesktopLayout();
    } else if (layout === 'mobile') {
      this.loadMobileLayout();
    }
    
    // Notificar callbacks
    this.triggerLayoutChange(layout, this.previousLayout);
  },
  
  /**
   * Carrega layout desktop (sidebar + content area)
   */
  async loadDesktopLayout() {
    logger.info('[LayoutManager] Carregando layout desktop...');
    
    try {
      // Carregar sidebar se não existir
      const sidebarMount = document.getElementById('sidebarMount');
      if (sidebarMount) sidebarMount.style.display = '';
      if (sidebarMount && !sidebarMount.hasChildNodes()) {
        const response = await fetch('/components/sidebar.html?v=' + Date.now(), { cache: 'no-store', credentials: 'include' });
        if (response.ok) {
          const html = await response.text();
          sidebarMount.innerHTML = html;
          
          // Executar scripts dentro do componente
          this.executeScripts(sidebarMount);
          
          logger.info('[LayoutManager] Sidebar carregada');
        }
      }
      
      // Ocultar bottom-nav
      const bottomNav = document.getElementById('bottomNavMount');
      if (bottomNav) bottomNav.style.display = 'none';
      
    } catch (error) {
      logger.error('[LayoutManager] Erro ao carregar desktop:', error);
    }
  },
  
  /**
   * Carrega layout mobile (bottom-nav + cards)
   */
  loadMobileLayout() {
    logger.info('[LayoutManager] Carregando layout mobile...');
    
    // Ocultar sidebar
    const sidebar = document.getElementById('sidebarMount');
    if (sidebar) sidebar.style.display = 'none';
    
    // Mostrar bottom-nav
    const bottomNav = document.getElementById('bottomNavMount');
    if (bottomNav) bottomNav.style.display = '';
    
    // Restaurar visibilidade do botão admin se usuário é admin
    // O botão foi configurado pelo initAdminMenu(), apenas garantir que não está oculto
    const adminBtn = document.getElementById('adminMenuBtn');
    if (adminBtn && adminBtn.style.display === 'inline-flex') {
      // Já está visível, não fazer nada
      logger.info('[LayoutManager] Botão admin mantido visível no mobile');
    }
  },
  
  /**
   * Entra em modo fullscreen
   */
  enterFullscreen(pageName = 'unknown') {
    logger.info(`[LayoutManager] Entrando em fullscreen: ${pageName}`);
    
    this.isFullscreen = true;
    this.fullscreenPage = pageName;
    
    document.body.setAttribute('data-layout', 'fullscreen');
    document.body.setAttribute('data-fullscreen-page', pageName);
    
    // Ocultar sidebar e bottom-nav
    const sidebar = document.getElementById('sidebarMount');
    const bottomNav = document.getElementById('bottomNavMount');
    if (sidebar) sidebar.style.display = 'none';
    if (bottomNav) bottomNav.style.display = 'none';
    
    this.triggerLayoutChange('fullscreen', this.currentLayout);
  },
  
  /**
   * Sai do modo fullscreen
   */
  exitFullscreen() {
    logger.info('[LayoutManager] Saindo de fullscreen');
    
    this.isFullscreen = false;
    this.fullscreenPage = null;
    
    document.body.removeAttribute('data-fullscreen-page');
    
    // Restaurar layout baseado no viewport
    this.detectAndApply();
  },
  
  /**
   * Handler para resize com debounce
   */
  handleResize() {
    clearTimeout(this.resizeTimer);
    this.resizeTimer = setTimeout(() => {
      this.detectAndApply();
    }, this.RESIZE_DEBOUNCE);
  },
  
  /**
   * Handler para mudança de orientação
   */
  handleOrientationChange() {
    // Aguardar a mudança de dimensões
    setTimeout(() => {
      this.detectAndApply();
    }, 100);
  },
  
  /**
   * Executa scripts dentro de um elemento
   */
  executeScripts(container) {
    const scripts = container.querySelectorAll('script');
    scripts.forEach(oldScript => {
      const newScript = document.createElement('script');
      if (oldScript.src) {
        newScript.src = oldScript.src;
      } else {
        newScript.textContent = oldScript.textContent;
      }
      oldScript.parentNode.replaceChild(newScript, oldScript);
    });
  },
  
  /**
   * Registra callback para mudança de layout
   */
  onChange(callback) {
    if (typeof callback === 'function') {
      this.onLayoutChange.push(callback);
    }
  },
  
  /**
   * Dispara callbacks de mudança de layout
   */
  triggerLayoutChange(newLayout, oldLayout) {
    this.onLayoutChange.forEach(callback => {
      try {
        callback(newLayout, oldLayout);
      } catch (error) {
        logger.error('[LayoutManager] Erro em callback:', error);
      }
    });
  },
  
  /**
   * Retorna o layout atual
   */
  getLayout() {
    return this.currentLayout;
  },
  
  /**
   * Verifica se está em desktop
   */
  isDesktop() {
    return this.currentLayout === 'desktop';
  },
  
  /**
   * Verifica se está em mobile
   */
  isMobile() {
    return this.currentLayout === 'mobile';
  },
  
  /**
   * Verifica se está em fullscreen
   */
  isInFullscreen() {
    return this.isFullscreen;
  }
};

// Auto-inicializar quando DOM estiver pronto
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', () => LayoutManager.init());
} else {
  LayoutManager.init();
}

// Exportar para uso global
window.LayoutManager = LayoutManager;
